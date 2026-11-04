/**
 * Pure helpers for the `school-notify-sms-webhook` Edge Function (also imported by the web app/tests).
 * Based on https://docs.sms-gate.app/features/webhooks/ :
 *  - Envelope: { deviceId, event, id, payload: { messageId, ... }, webhookId }
 *  - sms:sent {messageId, partsCount, sentAt}, sms:delivered {messageId, deliveredAt} (once PER PART),
 *    sms:failed {messageId, reason, failedAt}, sms:cancelled {messageId, cancelledAt}
 *  - Signing: headers X-Signature (hex HMAC-SHA256) and X-Timestamp (Unix seconds);
 *    signature = HMAC_SHA256(signingKey, rawBody + timestamp).
 */

export const MAX_WEBHOOK_BYTES = 64 * 1024;
/** Accept timestamps up to 5 minutes old (or 1 minute in the future). */
export const MAX_AGE_SEC = 300;
export const MAX_FUTURE_SEC = 60;

export type TrackedState = 'Pending' | 'Processed' | 'Sent' | 'Delivered' | 'Failed' | 'Cancelled';

export const STATE_RANK: Record<TrackedState, number> = {
  Pending: 0, Processed: 1, Sent: 2, Delivered: 3, Failed: 3, Cancelled: 3,
};
export const FINAL_STATES: TrackedState[] = ['Delivered', 'Failed', 'Cancelled'];

export const EVENT_TO_STATE: Record<string, TrackedState> = {
  'sms:sent': 'Sent',
  'sms:delivered': 'Delivered',
  'sms:failed': 'Failed',
  'sms:cancelled': 'Cancelled',
};

export function isTrackedState(s: unknown): s is TrackedState {
  return typeof s === 'string' && s in STATE_RANK;
}

/**
 * Returns the state to store, or null when nothing should change: final states are never
 * overwritten (Delivered is never downgraded), older/equal states are ignored (idempotent).
 */
export function mergeState(current: string | undefined | null, incoming: string): TrackedState | null {
  if (!isTrackedState(incoming)) return null;
  const cur: TrackedState = isTrackedState(current) ? current : 'Pending';
  if (FINAL_STATES.includes(cur)) return null;
  return STATE_RANK[incoming] > STATE_RANK[cur] ? incoming : null;
}

/** App log status for a gateway state. */
export function logStatusForState(s: TrackedState): 'pending' | 'sent' | 'delivered' | 'failed' {
  if (s === 'Delivered') return 'delivered';
  if (s === 'Sent') return 'sent';
  if (s === 'Failed' || s === 'Cancelled') return 'failed';
  return 'pending';
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison (length leak only). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

export type SignatureCheck = 'ok' | 'missing' | 'stale' | 'bad_signature';

export async function verifySignature(
  key: string,
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<SignatureCheck> {
  if (!key || !timestamp || !signature) return 'missing';
  if (!/^\d{1,12}$/.test(timestamp)) return 'stale';
  const ts = Number(timestamp);
  if (nowSec - ts > MAX_AGE_SEC || ts - nowSec > MAX_FUTURE_SEC) return 'stale';
  const sig = signature.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sig)) return 'bad_signature';
  const expected = await hmacHex(key, rawBody + timestamp);
  return timingSafeEqual(expected, sig) ? 'ok' : 'bad_signature';
}

export interface ParsedEvent {
  gatewayId: string;
  state: TrackedState;
  /** Short failure reason (sms:failed), phone-like digit runs masked. */
  error?: string;
}

/** Extracts what we store from a webhook envelope; null for events we do not track. Never returns phones/bodies. */
export function parseEvent(body: unknown): ParsedEvent | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const state = typeof b.event === 'string' ? EVENT_TO_STATE[b.event] : undefined;
  if (!state) return null;
  const p = (b.payload && typeof b.payload === 'object' ? b.payload : {}) as Record<string, unknown>;
  const id = p.messageId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,36}$/.test(id)) return null;
  const out: ParsedEvent = { gatewayId: id, state };
  if (state === 'Failed' && typeof p.reason === 'string' && p.reason.trim()) {
    out.error = p.reason.replace(/\+?\d{7,}/g, '***').slice(0, 200);
  }
  return out;
}
