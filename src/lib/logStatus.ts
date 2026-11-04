/**
 * Honest message-status helpers.
 * - 'sent'      = handed to the SMS gateway / opened in the messaging app. NOT a delivery confirmation.
 * - 'delivered' = only when the gateway explicitly confirms delivery (not implemented yet).
 * - 'failed'    = the gateway/request reported an error.
 * - 'pending'   = not attempted yet.
 */
import type { MessageLog } from '../types';

export type LogStatus = MessageLog['status'];

export const STATUS_LABELS: Record<LogStatus, string> = {
  pending: 'بانتظار الإرسال (أو قبلتها البوابة ولم يرسلها الهاتف بعد)',
  sent: 'أُرسلت من الهاتف (بدون تأكيد استلام)',
  delivered: 'تم تأكيد الاستلام',
  failed: 'فشل الإرسال',
};

export const CHANNEL_LABELS: Record<NonNullable<MessageLog['channel']>, string> = {
  gateway: 'بوابة SMSGate',
  manual: 'فتح يدوي لتطبيق الرسائل',
};

export interface LogSummary {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  failed: number;
  /** sent + delivered (handed over successfully) */
  successful: number;
  /** successful / (successful + failed), as a percentage; null when nothing was attempted */
  successRate: number | null;
}

export function summarizeLogs(logs: MessageLog[]): LogSummary {
  const s = { total: logs.length, pending: 0, sent: 0, delivered: 0, failed: 0 };
  for (const l of logs) {
    if (l.status in s) (s as any)[l.status]++;
  }
  const successful = s.sent + s.delivered;
  const attempted = successful + s.failed;
  return { ...s, successful, successRate: attempted ? Math.round((successful / attempted) * 100) : null };
}

/** Status to record after a gateway call. Never 'delivered': we have no delivery receipt. */
export function statusAfterGatewayCall(ok: boolean): LogStatus {
  return ok ? 'sent' : 'failed';
}

/**
 * Status to record from the gateway's per-message state. 'sent' only when the phone actually sent it;
 * an accepted-but-not-yet-sent message stays 'pending' (with meta.gatewayState = 'Pending'/'Processed').
 */
export function statusFromGatewayState(state: string | undefined): LogStatus {
  if (state === 'Delivered') return 'delivered';
  if (state === 'Sent') return 'sent';
  if (state === 'Failed' || state === 'Cancelled') return 'failed';
  return 'pending';
}
