/**
 * Client for the `school-notify-sms` Supabase Edge Function (the only way the app sends SMS).
 * The SMSGate credentials live only in the function's secrets; the browser never sees them.
 */
import { MAX_RECIPIENTS_PER_CALL, SmsItem, validateProxyRequest } from '../../supabase/functions/school-notify-sms/validate';
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

/**
 * Sends in batches of MAX_RECIPIENTS_PER_CALL. A request-level failure (e.g. gateway not configured)
 * stops the run: the remaining messages are reported with that error and nothing more is sent.
 */
export async function sendViaProxy(
  invoke: ProxyInvoker,
  msgs: OutgoingSms[],
  onProgress?: (results: ProxyItemResult[]) => void
): Promise<{ results: ProxyItemResult[]; fatalError?: string }> {
  const { items, rejected } = toProxyItems(msgs);
  const results: ProxyItemResult[] = [...rejected];
  if (rejected.length) onProgress?.([...results]);
  const batches = chunk(items, MAX_RECIPIENTS_PER_CALL);
  for (let b = 0; b < batches.length; b++) {
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
