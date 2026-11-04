/**
 * Client for the `school-notify-sms` Supabase Edge Function (the only way the app sends SMS).
 * The SMSGate credentials live only in the function's secrets; the browser never sees them.
 */
import { MAX_RECIPIENTS_PER_CALL, MAX_STATUS_IDS, SmsItem, validateProxyRequest } from '../../supabase/functions/school-notify-sms/validate';
import { toInternational } from './phone';
import { chunk } from './repo/mapping';

export { MAX_RECIPIENTS_PER_CALL, MAX_BODY_CHARS } from '../../supabase/functions/school-notify-sms/validate';

export interface ProxyItemResult {
  id: string;
  ok: boolean;
  error?: string;
  gatewayMessageId?: string;
}

export type ProxyResponse =
  | { ok: true; configured?: boolean; results?: ProxyItemResult[] }
  | { ok: false; error: string; httpStatus?: number };

export type ProxyInvoker = (body: unknown) => Promise<ProxyResponse>;

export interface OutgoingSms {
  id: string;
  /** Local or international phone; converted to E.164 here. */
  phone: string;
  text: string;
}

/** Converts outgoing messages to proxy items; items with an unusable phone are returned as failures. */
export function toProxyItems(msgs: OutgoingSms[]): { items: SmsItem[]; rejected: ProxyItemResult[] } {
  const items: SmsItem[] = [];
  const rejected: ProxyItemResult[] = [];
  for (const m of msgs) {
    const intl = toInternational(m.phone);
    if (!intl) rejected.push({ id: m.id, ok: false, error: 'invalid_phone' });
    else items.push({ id: m.id, phone: intl, text: m.text });
  }
  return { items, rejected };
}

export type GatewayState = 'Pending' | 'Cancelling' | 'Cancelled' | 'Processed' | 'Sent' | 'Delivered' | 'Failed' | 'Unknown';
export interface GatewayStatus {
  id: string;
  state: GatewayState;
  error?: string;
}

/** Recipients per Edge Function call; small batches are gentler on the sending phone/SIM. */
export const DEFAULT_BATCH_SIZE = 5;
/** Default pause between batches. */
export const DEFAULT_BATCH_DELAY_SEC = 10;

export interface SendOptions {
  batchSize?: number;
  /** Pause between batches (ms). */
  delayMs?: number;
  signal?: AbortSignal;
  /** Injected for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** setTimeout-based sleep that resolves early when aborted. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });
}

/**
 * Sends in small batches with a pause between them. A request-level failure (e.g. gateway not
 * configured) stops the run: the remaining messages are reported with that error. Aborting stops
 * before the next batch; unsent messages are reported with error 'aborted'.
 * ok=true means ACCEPTED by the gateway (queued), not sent by the phone; use pollMessageStatus.
 */
export async function sendViaProxy(
  invoke: ProxyInvoker,
  msgs: OutgoingSms[],
  onProgress?: (results: ProxyItemResult[]) => void,
  opts: SendOptions = {}
): Promise<{ results: ProxyItemResult[]; fatalError?: string; aborted?: boolean }> {
  const size = Math.max(1, Math.min(opts.batchSize ?? DEFAULT_BATCH_SIZE, MAX_RECIPIENTS_PER_CALL));
  const delayMs = Math.max(0, opts.delayMs ?? 0);
  const wait = opts.sleep ?? sleep;
  const { items, rejected } = toProxyItems(msgs);
  const results: ProxyItemResult[] = [...rejected];
  if (rejected.length) onProgress?.([...results]);
  const batches = chunk(items, size);
  for (let b = 0; b < batches.length; b++) {
    if (b > 0 && delayMs) await wait(delayMs, opts.signal);
    if (opts.signal?.aborted) {
      results.push(...batches.slice(b).flat().map(i => ({ id: i.id, ok: false, error: 'aborted' })));
      onProgress?.([...results]);
      return { results, aborted: true };
    }
    const batch = batches[b];
    const body = { action: 'send', messages: batch };
    const v = validateProxyRequest(body);
    let res: ProxyResponse;
    if ('error' in v) res = { ok: false, error: v.error };
    else {
      try {
        res = await invoke(body);
      } catch {
        res = { ok: false, error: 'offline' };
      }
    }
    if ('error' in res) {
      const fatal = res.error;
      const rest = batches.slice(b).flat();
      results.push(...rest.map(i => ({ id: i.id, ok: false, error: fatal })));
      onProgress?.([...results]);
      return { results, fatalError: fatal };
    }
    const byId = new Map((res.results ?? []).map(r => [r.id, r]));
    for (const i of batch) results.push(byId.get(i.id) ?? { id: i.id, ok: false, error: 'no_result' });
    onProgress?.([...results]);
  }
  return { results };
}

/** States after which we stop polling a message. */
export const FINAL_GATEWAY_STATES: GatewayState[] = ['Sent', 'Delivered', 'Failed', 'Cancelled'];

export interface PollOptions {
  intervalMs?: number;
  /** Upper bound for the whole polling run. */
  timeoutMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onUpdate?: (statuses: Map<string, GatewayStatus>) => void;
}

/**
 * Polls `messageStatus` for gateway ids until each is final (Sent/Delivered/Failed/Cancelled),
 * the time bound is reached, or aborted. Ids never polled successfully stay 'Pending'.
 */
export async function pollMessageStatus(
  invoke: ProxyInvoker,
  gatewayIds: string[],
  opts: PollOptions = {}
): Promise<Map<string, GatewayStatus>> {
  const intervalMs = opts.intervalMs ?? 10_000;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const wait = opts.sleep ?? sleep;
  const ids = [...new Set(gatewayIds.filter(Boolean))];
  const map = new Map<string, GatewayStatus>(ids.map(id => [id, { id, state: 'Pending' as GatewayState }]));
  const rounds = Math.max(1, Math.floor(timeoutMs / Math.max(1, intervalMs)));
  for (let round = 0; round < rounds; round++) {
    await wait(intervalMs, opts.signal);
    if (opts.signal?.aborted) break;
    const open = ids.filter(id => !FINAL_GATEWAY_STATES.includes(map.get(id)!.state));
    if (!open.length) break;
    let stop = false;
    for (const part of chunk(open, MAX_STATUS_IDS)) {
      let res: any;
      try {
        res = await invoke({ action: 'messageStatus', ids: part });
      } catch {
        res = { ok: false, error: 'offline' };
      }
      if (!res?.ok) {
        // Session/permission/config problems will not fix themselves: stop polling.
        if (['unauthorized', 'not_allowed', 'sms_gateway_not_configured'].includes(res?.error)) stop = true;
        continue;
      }
      for (const st of (res.statuses ?? []) as GatewayStatus[]) {
        if (!map.has(st.id)) continue;
        if (st.state === 'Unknown' && st.error === 'gateway_auth_failed') stop = true;
        // Unknown (temporary lookup error) never overwrites a known state.
        if (st.state !== 'Unknown') map.set(st.id, { id: st.id, state: st.state, ...(st.error ? { error: st.error } : {}) });
      }
    }
    opts.onUpdate?.(new Map(map));
    if (stop) break;
    if (ids.every(id => FINAL_GATEWAY_STATES.includes(map.get(id)!.state))) break;
  }
  return map;
}

export interface GatewayCounts {
  accepted: number;
  pending: number;
  sent: number;
  delivered: number;
  failed: number;
}

export function countGatewayStates(statuses: Iterable<GatewayStatus>): GatewayCounts {
  const c: GatewayCounts = { accepted: 0, pending: 0, sent: 0, delivered: 0, failed: 0 };
  for (const s of statuses) {
    c.accepted++;
    if (s.state === 'Sent') c.sent++;
    else if (s.state === 'Delivered') c.delivered++;
    else if (s.state === 'Failed' || s.state === 'Cancelled') c.failed++;
    else c.pending++;
  }
  return c;
}

/** Arabic one-liner: "قبلتها البوابة: N — الحالة: ..." */
export function gatewayCountsText(c: GatewayCounts): string {
  return `قبلتها البوابة: ${c.accepted} — الحالة: أُرسلت من الهاتف ${c.sent}، تم التسليم ${c.delivered}، بانتظار الهاتف ${c.pending}، فشلت ${c.failed}`;
}

export const GATEWAY_STATE_LABELS: Record<GatewayState, string> = {
  Pending: 'قبلتها البوابة، بانتظار الهاتف',
  Processed: 'استلمها الهاتف، قيد الإرسال',
  Sent: 'أُرسلت من الهاتف',
  Delivered: 'تم تأكيد التسليم',
  Failed: 'فشل الإرسال من الهاتف',
  Cancelling: 'جارٍ الإلغاء',
  Cancelled: 'أُلغيت',
  Unknown: 'حالة غير معروفة',
};

/** Arabic, user-facing text for a proxy error code. */
export function proxyErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'sms_gateway_not_configured':
      return 'بوابة SMS غير مهيأة بعد في الخادم: يجب على مسؤول النظام إضافة بيانات SMSGate في أسرار الخادم (Supabase). لم تُرسل أي رسالة.';
    case 'not_allowed':
      return 'هذا الحساب غير مصرح له بإرسال الرسائل.';
    case 'unauthorized':
      return 'انتهت الجلسة. الرجاء تسجيل الدخول من جديد.';
    case 'offline':
      return 'تعذر الوصول إلى خادم الإرسال. تحقق من اتصال الإنترنت.';
    case 'origin_not_allowed':
      return 'تم رفض الطلب لأن مصدر الصفحة غير مسموح.';
    case 'too_many_recipients':
    case 'invalid_item':
    case 'invalid_action':
    case 'invalid_json':
    case 'no_recipients':
      return 'طلب الإرسال غير صالح (عدد المستلمين أو صيغة الرقم أو طول النص).';
    case 'aborted':
      return 'أُوقف الإرسال يدوياً قبل إرسال هذه الرسالة.';
    case 'invalid_phone':
      return 'رقم الجوال غير صالح.';
    case 'gateway_auth_failed':
      return 'بيانات SMSGate المحفوظة في الخادم غير صحيحة (رفضت البوابة المصادقة).';
    case 'gateway_timeout':
    case 'gateway_unreachable':
      return 'تعذر الاتصال ببوابة SMSGate. حاول لاحقاً.';
    case 'gateway_rejected':
      return 'رفضت بوابة SMSGate الرسالة.';
    case 'client_not_configured':
      return 'التطبيق غير مهيأ للاتصال بالخادم.';
    default:
      return 'تعذر إرسال الرسالة عبر البوابة.';
  }
}
