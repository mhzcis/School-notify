/**
 * Durable pause/resume for a bulk send through the cloud gateway.
 *
 * The job lives in localStorage so it survives a reload. It never stores message bodies,
 * Moodle passwords or raw phone numbers: only the template, the student id and a short hash of
 * the number. On resume, every remaining message is rebuilt from the CURRENT student data,
 * the CURRENT do-not-send list and freshly loaded credentials, then confirmed again.
 *
 * Safety rule: a message is sent at most once.
 *  - 'accepted' (gateway took it) is never sent again;
 *  - 'inflight' (request left the browser, answer unknown: reload/crash/network drop) becomes
 *    'unknown' and is NOT re-sent automatically. The teacher checks Reports / the phone instead;
 *  - only 'queued' entries (never left the browser) are sent on resume.
 */
import type { Student } from '../types';
import { buildDispatchItems, type DispatchItem, type DispatchRender, type PhoneTarget } from './recipients';
import { checkPhone } from './phone';
import type { ProxyItemResult } from './smsProxy';

export const BULK_JOB_KEY = 'sn_bulk_send_job';

export type JobEntryState = 'queued' | 'inflight' | 'accepted' | 'failed' | 'unknown' | 'skipped';
export type PauseReason = 'manual' | 'reload' | 'quiet_hours' | 'error';
export type SkipReason = 'suppressed' | 'student_missing' | 'phone_changed';

export interface JobEntry {
  key: string;
  studentId: string;
  /** FNV-1a hash of the local number (05XXXXXXXX); the number itself is not stored. */
  phoneHash: string;
  state: JobEntryState;
  gatewayMessageId?: string;
  error?: string;
}

export interface BulkSendJob {
  v: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  contentTemplate: string;
  phoneTarget: PhoneTarget;
  isTest: boolean;
  campaignId?: string;
  status: 'running' | 'paused' | 'finished';
  pauseReason?: PauseReason;
  lastError?: string;
  entries: JobEntry[];
}

export interface JobCounts {
  total: number;
  queued: number;
  accepted: number;
  failed: number;
  unknown: number;
  skipped: number;
  inflight: number;
}

/** FNV-1a 32-bit, hex. Enough to re-identify a number on resume without storing it. */
export function hashPhone(phone: string): string {
  const local = checkPhone(phone).valid ? checkPhone(phone).local : String(phone ?? '').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < local.length; i++) {
    h ^= local.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function createJob(
  items: DispatchItem[],
  meta: { id: string; title: string; contentTemplate: string; phoneTarget: PhoneTarget; isTest?: boolean; campaignId?: string; now?: Date },
): { job: BulkSendJob; keyed: Array<{ key: string; item: DispatchItem }> } {
  const at = (meta.now ?? new Date()).toISOString();
  const keyed = items.map((item, i) => ({ key: `m${i}`, item }));
  const job: BulkSendJob = {
    v: 1,
    id: meta.id,
    createdAt: at,
    updatedAt: at,
    title: meta.title,
    contentTemplate: meta.contentTemplate,
    phoneTarget: meta.phoneTarget,
    isTest: Boolean(meta.isTest),
    ...(meta.campaignId ? { campaignId: meta.campaignId } : {}),
    status: 'running',
    entries: keyed.map(k => ({ key: k.key, studentId: k.item.studentId, phoneHash: hashPhone(k.item.phone), state: 'queued' as const })),
  };
  return { job, keyed };
}

export function jobCounts(job: BulkSendJob): JobCounts {
  const c: JobCounts = { total: job.entries.length, queued: 0, accepted: 0, failed: 0, unknown: 0, skipped: 0, inflight: 0 };
  for (const e of job.entries) c[e.state] += 1;
  return c;
}

function touch(job: BulkSendJob, entries: JobEntry[], patch: Partial<BulkSendJob> = {}, now = new Date()): BulkSendJob {
  return { ...job, ...patch, entries, updatedAt: now.toISOString() };
}

/** Marks a batch as having left the browser (persist this BEFORE the request is made). */
export function markInflight(job: BulkSendJob, keys: string[], now?: Date): BulkSendJob {
  const set = new Set(keys);
  return touch(job, job.entries.map(e => (set.has(e.key) && e.state === 'queued' ? { ...e, state: 'inflight' as const } : e)), { status: 'running' }, now);
}

/** Errors that mean the request may have reached the gateway (do not resend automatically). */
const UNCERTAIN_ERRORS = new Set(['offline', 'no_result']);
/**
 * Per-item errors where the gateway refused the request, so nothing was sent: the item goes back
 * to 'queued' and the job pauses so the teacher can fix the setting and resume.
 */
export const PAUSE_ON_ITEM_ERRORS = new Set(['gateway_auth_failed', 'gateway_forbidden', 'sms_gateway_not_configured']);

/**
 * Applies results from sendViaProxy.
 * - ok → accepted; 'aborted' (never left the browser) → queued again;
 * - request-level fatal error: entries of the batch in flight become 'unknown' if the outcome is
 *   uncertain (network drop), otherwise they go back to 'queued' (the request was refused before
 *   sending) and the job pauses with the error;
 * - other per-item errors → failed (shown in Reports; never retried automatically).
 */
export function applyResults(
  job: BulkSendJob,
  results: ProxyItemResult[],
  opts: { fatalError?: string; pauseReason?: PauseReason; now?: Date } = {},
): BulkSendJob {
  const byKey = new Map(results.map(r => [r.id, r]));
  let itemStop: string | undefined;
  const entries = job.entries.map(e => {
    const r = byKey.get(e.key);
    if (!r) return e;
    if (r.ok) return { ...e, state: 'accepted' as const, gatewayMessageId: r.gatewayMessageId, error: undefined };
    if (r.error === 'aborted') return { ...e, state: 'queued' as const };
    if (opts.fatalError && r.error === opts.fatalError) {
      if (e.state === 'inflight' && UNCERTAIN_ERRORS.has(r.error)) return { ...e, state: 'unknown' as const, error: r.error };
      return { ...e, state: 'queued' as const };
    }
    if (r.error && PAUSE_ON_ITEM_ERRORS.has(r.error)) {
      itemStop = itemStop ?? r.error;
      return { ...e, state: 'queued' as const };
    }
    if (e.state === 'inflight' && r.error && UNCERTAIN_ERRORS.has(r.error)) return { ...e, state: 'unknown' as const, error: r.error };
    return { ...e, state: 'failed' as const, error: r.error };
  });
  const lastError = opts.fatalError ?? itemStop;
  const remaining = entries.some(e => e.state === 'queued' || e.state === 'inflight');
  const status: BulkSendJob['status'] = remaining ? 'paused' : 'finished';
  const pauseReason: PauseReason | undefined = remaining ? (lastError ? 'error' : opts.pauseReason ?? 'manual') : undefined;
  return touch(job, entries, { status, pauseReason, lastError }, opts.now);
}

/** After a reload: a 'running' job was interrupted. In-flight entries become 'unknown' (never auto-resent). */
export function recoverAfterReload(job: BulkSendJob, now?: Date): BulkSendJob {
  if (job.status !== 'running' && !job.entries.some(e => e.state === 'inflight')) return job;
  const entries = job.entries.map(e => (e.state === 'inflight' ? { ...e, state: 'unknown' as const, error: 'interrupted' } : e));
  const remaining = entries.some(e => e.state === 'queued');
  return touch(job, entries, { status: remaining ? 'paused' : 'finished', pauseReason: remaining ? 'reload' : undefined }, now);
}

export interface ResumePlan {
  keyed: Array<{ key: string; item: DispatchItem }>;
  skipped: Array<{ key: string; studentId: string; reason: SkipReason }>;
}

/**
 * Rebuilds the not-yet-sent messages from current data. Numbers now on the do-not-send list,
 * students that were deleted, and numbers that changed since the pause are skipped (never sent).
 */
export function planResume(
  job: BulkSendJob,
  students: Student[],
  render: DispatchRender,
  suppressed: Set<string> = new Set(),
): ResumePlan {
  const byId = new Map(students.map(s => [s.id, s]));
  const keyed: ResumePlan['keyed'] = [];
  const skipped: ResumePlan['skipped'] = [];
  const cache = new Map<string, ReturnType<typeof buildDispatchItems>>();
  for (const e of job.entries) {
    if (e.state !== 'queued') continue;
    const s = byId.get(e.studentId);
    if (!s) {
      skipped.push({ key: e.key, studentId: e.studentId, reason: 'student_missing' });
      continue;
    }
    let built = cache.get(s.id);
    if (!built) {
      built = buildDispatchItems([s], job.phoneTarget, job.contentTemplate, render, suppressed);
      cache.set(s.id, built);
    }
    const item = built.items.find(i => hashPhone(i.phone) === e.phoneHash);
    if (item) {
      keyed.push({ key: e.key, item });
      continue;
    }
    const sup = built.excluded.find(x => x.problem === 'suppressed' && hashPhone(x.rawPhone) === e.phoneHash);
    skipped.push({ key: e.key, studentId: e.studentId, reason: sup ? 'suppressed' : 'phone_changed' });
  }
  return { keyed, skipped };
}

export function applySkips(job: BulkSendJob, skipped: ResumePlan['skipped'], now?: Date): BulkSendJob {
  if (!skipped.length) return job;
  const m = new Map(skipped.map(s => [s.key, s.reason]));
  return touch(job, job.entries.map(e => (m.has(e.key) && e.state === 'queued' ? { ...e, state: 'skipped' as const, error: m.get(e.key) } : e)), {}, now);
}

export const PAUSE_REASON_LABELS: Record<PauseReason, string> = {
  manual: 'أوقفته يدوياً',
  reload: 'انقطع (إعادة تحميل الصفحة أو إغلاقها)',
  quiet_hours: 'دخل وقت ساعات الهدوء',
  error: 'توقف بسبب خطأ',
};

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  suppressed: 'أصبح في قائمة عدم الإرسال',
  student_missing: 'الطالب لم يعد موجوداً',
  phone_changed: 'تغيّر الرقم منذ الإيقاف',
};

// ----- storage -----

function isJob(v: unknown): v is BulkSendJob {
  if (!v || typeof v !== 'object') return false;
  const j = v as BulkSendJob;
  return j.v === 1 && typeof j.id === 'string' && typeof j.contentTemplate === 'string' && Array.isArray(j.entries)
    && ['primary', 'secondary', 'both'].includes(j.phoneTarget)
    && j.entries.every(e => e && typeof e.key === 'string' && typeof e.studentId === 'string' && typeof e.phoneHash === 'string'
      && ['queued', 'inflight', 'accepted', 'failed', 'unknown', 'skipped'].includes(e.state));
}

export function readJob(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): BulkSendJob | null {
  try {
    const raw = storage?.getItem(BULK_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isJob(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeJob(job: BulkSendJob, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(BULK_JOB_KEY, JSON.stringify(job));
  } catch {
    /* storage full / disabled: the in-memory job still works for this session */
  }
}

export function clearJob(storage: Pick<Storage, 'removeItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.removeItem(BULK_JOB_KEY);
  } catch {
    /* ignore */
  }
}

/** True when the job still has messages that could be sent on resume. */
export function jobHasRemaining(job: BulkSendJob | null): boolean {
  return Boolean(job && job.entries.some(e => e.state === 'queued'));
}

/** True when the job should stay visible: messages left to send, or messages with an unknown outcome. */
export function jobNeedsAttention(job: BulkSendJob | null): boolean {
  return Boolean(job && job.entries.some(e => e.state === 'queued' || e.state === 'inflight' || e.state === 'unknown'));
}
