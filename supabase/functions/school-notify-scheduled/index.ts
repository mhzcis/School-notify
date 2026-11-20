// school-notify-scheduled — cron-invoked sender for due scheduled campaigns.
//
// Authentication: header X-Scheduler-Secret must match SCHEDULER_CRON_SECRET.
// verify_jwt should be false (this is not a browser call).
//
// Kill switches (ALL must be on or nothing is sent):
//   1. Function deployed and reachable.
//   2. SCHEDULER_CRON_SECRET set and presented by the caller.
//   3. SCHEDULER_ENABLED secret exactly equal to "true" (missing/false = off).
//   4. Owner row in school_notify.scheduler_settings with enabled = true
//      (defaults false; only the teacher can turn it on after the migration).
//   5. Numbers on the owner's do-not-send list (suppressed_phones) are never sent to.
//   6. Campaign is due, not archived, not immediate, not in quiet hours
//      (22:00–07:00 Asia/Jerusalem) unless quietHoursOverride was stored.
//
// Idempotent: claims rows with FOR UPDATE SKIP LOCKED; skips phones already
// logged for the campaign (except failed, which may be retried). Caps messages
// per run from the owner's max_per_run (default 50). Never logs phones,
// message bodies, or credentials. Touches only the school_notify schema.
import { sendOne, type ItemResult } from './gateway.ts';
import {
  alreadySentKeys,
  buildItems,
  DEFAULT_MAX_PER_RUN,
  excludeSuppressed,
  remainingItems,
  resolveTargets,
  templateUsesCredentials,
  type StudentRec,
} from './dispatch.ts';

const MAX_CAMPAIGNS = 3;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function secretOk(req: Request): boolean {
  const expected = Deno.env.get('SCHEDULER_CRON_SECRET') ?? '';
  if (!expected) return false;
  const got = req.headers.get('X-Scheduler-Secret') ?? '';
  if (got.length !== expected.length) return false;
  // Constant-time-ish compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function basicAuth(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'Basic ' + btoa(bin);
}

function restHeaders(serviceKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Profile': 'school_notify',
    'Accept-Profile': 'school_notify',
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extra,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST' && req.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });
  if (!secretOk(req)) return json(401, { ok: false, error: 'unauthorized' });

  // Global kill switch: missing or any value other than "true" means do nothing.
  if ((Deno.env.get('SCHEDULER_ENABLED') ?? '') !== 'true') {
    return json(200, { ok: true, skipped: 'global_disabled', sent: 0, campaigns: 0 });
  }

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !serviceKey) return json(500, { ok: false, error: 'missing_service_config' });

  const smsUser = Deno.env.get('SMSGATE_USERNAME') ?? '';
  const smsPass = Deno.env.get('SMSGATE_PASSWORD') ?? '';
  if (!smsUser || !smsPass) return json(503, { ok: false, error: 'sms_gateway_not_configured' });
  const passphrase = Deno.env.get('SMSGATE_ENCRYPTION_PASSPHRASE') || undefined;
  const auth = basicAuth(smsUser, smsPass);

  const headers = restHeaders(serviceKey);
  const rpc = await fetch(`${url}/rest/v1/rpc/claim_due_campaigns`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_limit: MAX_CAMPAIGNS }),
  });
  if (!rpc.ok) {
    const status = rpc.status;
    await rpc.body?.cancel();
    console.log(`school-notify-scheduled: claim_failed status=${status}`);
    return json(502, { ok: false, error: 'claim_failed' });
  }
  const claimed = (await rpc.json()) as any[];
  if (!Array.isArray(claimed) || claimed.length === 0) {
    return json(200, { ok: true, campaigns: 0, sent: 0 });
  }

  let sent = 0;
  let failed = 0;
  let skippedCred = 0;

  for (const row of claimed) {
    const campaignId = row.id as string;
    const owner = row.owner as string;
    const template = String(row.body ?? '');
    const meta = (row.meta && typeof row.meta === 'object') ? row.meta as Record<string, unknown> : {};
    const allowCreds = Boolean(meta.allowCredentialsAutosend);
    const phoneTarget = (meta.phoneTarget === 'secondary' || meta.phoneTarget === 'both') ? meta.phoneTarget : 'primary';
    const isTest = Boolean(meta.isTest);

    if (templateUsesCredentials(template) && !allowCreds) {
      skippedCred += 1;
      await patchCampaign(url, headers, campaignId, 'pending', { schedulerSkipReason: 'credentials' });
      continue;
    }

    const settingsRes = await fetch(`${url}/rest/v1/scheduler_settings?owner=eq.${owner}&select=enabled,max_per_run`, { headers });
    const settings = settingsRes.ok ? await settingsRes.json() : [];
    const enabled = Array.isArray(settings) && settings[0]?.enabled === true;
    const maxPerRun = Number(settings?.[0]?.max_per_run) || DEFAULT_MAX_PER_RUN;
    if (!enabled) {
      await patchCampaign(url, headers, campaignId, 'pending', { schedulerSkipReason: 'disabled' });
      continue;
    }

    const stRes = await fetch(
      `${url}/rest/v1/students?owner=eq.${owner}&select=id,national_id,name,parent_name,phone,class_name,extra&limit=5000`,
      { headers },
    );
    if (!stRes.ok) {
      await stRes.body?.cancel();
      await patchCampaign(url, headers, campaignId, 'pending', { schedulerSkipReason: 'students_load_failed' });
      continue;
    }
    const stRows = (await stRes.json()) as any[];
    let students: StudentRec[] = (stRows ?? []).map(r => {
      const extra = (r.extra && typeof r.extra === 'object') ? r.extra : {};
      return {
        uuid: r.id,
        nationalId: r.national_id,
        name: r.name ?? '',
        parentName: r.parent_name ?? '',
        phone: r.phone ?? '',
        phone2: extra.phone2,
        grade: r.class_name ?? '',
        section: extra.section ?? '',
      } as StudentRec;
    });

    if (templateUsesCredentials(template) && allowCreds) {
      const cr = await fetch(
        `${url}/rest/v1/student_moodle_credentials?owner=eq.${owner}&select=national_id,moodle_username,moodle_password,default_password`,
        { headers },
      );
      if (cr.ok) {
        const creds = (await cr.json()) as any[];
        const map = new Map((creds ?? []).map(c => [String(c.national_id), c]));
        students = students.map(s => {
          const c = map.get(s.nationalId);
          return c ? { ...s, moodleUsername: c.moodle_username, moodlePassword: c.moodle_password, moodleDefaultPassword: c.default_password ?? '' } : s;
        });
      } else {
        await cr.body?.cancel();
        skippedCred += 1;
        await patchCampaign(url, headers, campaignId, 'pending', { schedulerSkipReason: 'credentials_table_missing' });
        continue;
      }
    }

    const targets = resolveTargets({
      targetType: String(meta.targetType ?? 'all'),
      targetGrade: meta.targetGrade as string | undefined,
      targetSection: meta.targetSection as string | undefined,
      targetStudentIds: Array.isArray(meta.targetStudentIds) ? meta.targetStudentIds.map(String) : undefined,
    }, students);

    const logRes = await fetch(
      `${url}/rest/v1/messages?campaign_id=eq.${campaignId}&select=phone,status,meta&limit=5000`,
      { headers },
    );
    const logRows = logRes.ok ? await logRes.json() : [];
    const prior = (Array.isArray(logRows) ? logRows : []).map((r: any) => ({
      studentId: String(r.meta?.appStudentId ?? ''),
      phone: String(r.phone ?? ''),
      status: String(r.status ?? ''),
    }));
    // Do-not-send list: fail closed (keep the campaign pending) if it cannot be read.
    const supRes = await fetch(`${url}/rest/v1/suppressed_phones?owner=eq.${owner}&select=phone&limit=10000`, { headers });
    if (!supRes.ok) {
      await supRes.body?.cancel();
      await patchCampaign(url, headers, campaignId, 'pending', { schedulerSkipReason: 'suppression_load_failed' });
      continue;
    }
    const suppressed = new Set(((await supRes.json()) as any[] ?? []).map(r => String(r.phone ?? '')));
    const allItems = excludeSuppressed(buildItems(targets, phoneTarget, template), suppressed);
    const items = remainingItems(allItems, alreadySentKeys(prior)).slice(0, Math.max(1, Math.min(maxPerRun, 200)));

    if (!items.length) {
      await patchCampaign(url, headers, campaignId, 'completed', { schedulerSkipReason: 'already_sent' });
      continue;
    }

    const results: ItemResult[] = [];
    let authFailed: string | null = null;
    for (const item of items) {
      if (authFailed) {
        results.push({ id: item.studentId, ok: false, error: authFailed });
        continue;
      }
      const r = await sendOne({ id: item.studentId.slice(0, 64), phone: item.phoneE164, text: item.content }, auth, fetch, passphrase);
      if (r.authFailed) authFailed = r.error ?? 'gateway_auth_failed';
      results.push(r);
    }

    const nowIso = new Date().toISOString();
    const messageRows = items.map((item, i) => {
      const r = results[i];
      const ok = r?.ok === true;
      if (ok) sent += 1; else failed += 1;
      return {
        id: crypto.randomUUID(),
        owner,
        campaign_id: campaignId,
        student_id: item.studentUuid,
        phone: item.phoneLocal,
        body: item.logContent, // already masked when the template has secrets
        status: ok ? 'sent' : 'failed',
        error: ok ? null : (r?.error ?? 'send_failed'),
        sent_at: nowIso,
        meta: {
          appStudentId: item.studentId,
          studentName: item.studentName,
          parentName: item.parentName,
          grade: item.grade,
          section: item.section,
          channel: 'gateway',
          ...(r?.gatewayMessageId ? { gatewayMessageId: r.gatewayMessageId } : {}),
          contentTemplate: template,
          ...(isTest ? { isTest: true } : {}),
          sentBy: 'scheduler',
        },
      };
    });
    if (messageRows.length) {
      const ins = await fetch(`${url}/rest/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(messageRows),
      });
      if (!ins.ok) await ins.body?.cancel();
    }

    const stillLeft = remainingItems(allItems, alreadySentKeys(prior.concat(
      items.map((item, i) => ({ studentId: item.studentId, phone: item.phoneLocal, status: results[i]?.ok ? 'sent' : 'failed' })),
    )));
    if (stillLeft.length) {
      // More to send on the next tick. Release the claim so claim_due_campaigns can pick it up.
      await patchCampaign(url, headers, campaignId, 'pending', { schedulerPartial: true });
    } else {
      await patchCampaign(url, headers, campaignId, 'completed', { schedulerPartial: false });
    }
  }

  console.log(`school-notify-scheduled: campaigns=${claimed.length} sent=${sent} failed=${failed} skipped_credentials=${skippedCred}`);
  return json(200, { ok: true, campaigns: claimed.length, sent, failed, skippedCredentials: skippedCred });
});

async function patchCampaign(url: string, headers: Record<string, string>, id: string, status: string, extraMeta: Record<string, unknown>): Promise<void> {
  const cur = await fetch(`${url}/rest/v1/campaigns?id=eq.${id}&select=meta`, { headers });
  const rows = cur.ok ? await cur.json() : [];
  const meta = (Array.isArray(rows) && rows[0]?.meta && typeof rows[0].meta === 'object') ? rows[0].meta : {};
  const next = { ...meta, ...extraMeta };
  const res = await fetch(`${url}/rest/v1/campaigns?id=eq.${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status, meta: next }),
  });
  if (!res.ok) await res.body?.cancel();
}
