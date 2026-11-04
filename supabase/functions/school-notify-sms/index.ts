// school-notify-sms — authenticated SMS proxy for School Notify.
//
// * verify_jwt = true (the platform rejects calls without a valid user JWT).
// * Re-checks school_notify.is_allowed() with the CALLER's JWT (RLS-style allow-list).
// * Forwards each message to SMSGate cloud with Basic auth from the function secrets
//   SMSGATE_USERNAME / SMSGATE_PASSWORD (set by the owner in the dashboard; never in code).
// * CORS: https://mhzcis.github.io and http://localhost only.
// * Never logs phone numbers, message bodies or credentials.
import { MAX_REQUEST_BYTES, isAllowedOrigin, validateProxyRequest, type SmsItem } from './validate.ts';

const SMSGATE_URL = 'https://api.sms-gate.app/3rdparty/v1/message';
const GATEWAY_TIMEOUT_MS = 15_000;

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
  };
  if (origin && isAllowedOrigin(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function basicAuth(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'Basic ' + btoa(bin);
}

async function callerIsAllowed(authHeader: string): Promise<'yes' | 'no' | 'unauthorized' | 'error'> {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return 'error';
  try {
    const res = await fetch(`${url}/rest/v1/rpc/is_allowed`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: authHeader,
        'Content-Type': 'application/json',
        'Content-Profile': 'school_notify',
        'Accept-Profile': 'school_notify',
      },
      body: '{}',
    });
    if (res.status === 401) return 'unauthorized';
    if (!res.ok) return 'error';
    return (await res.json()) === true ? 'yes' : 'no';
  } catch {
    return 'error';
  }
}

interface ItemResult {
  id: string;
  ok: boolean;
  error?: string;
  gatewayMessageId?: string;
}

async function sendOne(item: SmsItem, auth: string): Promise<ItemResult & { authFailed?: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS);
  try {
    const res = await fetch(SMSGATE_URL, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ textMessage: { text: item.text }, phoneNumbers: [item.phone] }),
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      return { id: item.id, ok: false, error: 'gateway_auth_failed', authFailed: true };
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { id: item.id, ok: false, error: 'gateway_rejected' };
    }
    let gatewayMessageId: string | undefined;
    try {
      const j = await res.json();
      if (j && typeof j.id === 'string') gatewayMessageId = j.id;
    } catch {
      /* ignore body */
    }
    return { id: item.id, ok: true, gatewayMessageId };
  } catch (err) {
    return { id: item.id, ok: false, error: (err as Error)?.name === 'AbortError' ? 'gateway_timeout' : 'gateway_unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: isAllowedOrigin(origin) ? 204 : 403, headers: corsHeaders(origin) });
  }
  // Browsers always send Origin on cross-origin POST; reject foreign pages. (Non-browser callers still need a valid JWT.)
  if (origin && !isAllowedOrigin(origin)) return json(403, { ok: false, error: 'origin_not_allowed' }, origin);
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, origin);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+$/.test(authHeader)) return json(401, { ok: false, error: 'unauthorized' }, origin);

  const allowed = await callerIsAllowed(authHeader);
  if (allowed === 'unauthorized') return json(401, { ok: false, error: 'unauthorized' }, origin);
  if (allowed === 'no') return json(403, { ok: false, error: 'not_allowed' }, origin);
  if (allowed === 'error') return json(502, { ok: false, error: 'allow_check_failed' }, origin);

  const len = Number(req.headers.get('Content-Length') ?? '0');
  if (len > MAX_REQUEST_BYTES) return json(413, { ok: false, error: 'invalid_json' }, origin);
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return json(400, { ok: false, error: 'invalid_json' }, origin);
  }
  if (raw.length > MAX_REQUEST_BYTES) return json(413, { ok: false, error: 'invalid_json' }, origin);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: 'invalid_json' }, origin);
  }

  const v = validateProxyRequest(body);
  if ('error' in v) return json(400, { ok: false, error: v.error, details: v.details }, origin);

  const user = Deno.env.get('SMSGATE_USERNAME') ?? '';
  const pass = Deno.env.get('SMSGATE_PASSWORD') ?? '';
  const configured = !!user && !!pass;

  if (v.value.action === 'status') return json(200, { ok: true, configured }, origin);

  if (!configured) {
    return json(503, { ok: false, error: 'sms_gateway_not_configured', message: 'SMS gateway not configured' }, origin);
  }

  const auth = basicAuth(user, pass);
  const results: ItemResult[] = [];
  let authFailed = false;
  for (const item of v.value.messages) {
    if (authFailed) {
      results.push({ id: item.id, ok: false, error: 'gateway_auth_failed' });
      continue;
    }
    const r = await sendOne(item, auth);
    if (r.authFailed) authFailed = true;
    results.push({ id: r.id, ok: r.ok, error: r.error, gatewayMessageId: r.gatewayMessageId });
  }
  // Counts only — no phones, bodies or credentials in logs.
  console.log(`school-notify-sms: sent=${results.filter(r => r.ok).length} failed=${results.filter(r => !r.ok).length}`);
  return json(200, { ok: true, results }, origin);
});
