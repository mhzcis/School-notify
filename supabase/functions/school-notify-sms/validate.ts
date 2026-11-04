/**
 * Pure request validation for the `school-notify-sms` Edge Function.
 * Shared with the web app (imported by src/lib/smsProxy.ts and unit tests). No Deno/browser APIs here.
 */

/** Max recipients accepted in one call (the web app batches larger campaigns). */
export const MAX_RECIPIENTS_PER_CALL = 50;
/** Max characters per message body (10 Arabic UCS-2 SMS parts of 67 chars). */
export const MAX_BODY_CHARS = 670;
/** Max request body size in bytes. */
export const MAX_REQUEST_BYTES = 100_000;
/** E.164 phone number, e.g. +970590000001. */
export const PHONE_RE = /^\+[1-9]\d{7,14}$/;
/** Client-chosen opaque id used to match results; never a phone number. */
export const ITEM_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Max gateway message ids per `messageStatus` call. */
export const MAX_STATUS_IDS = 50;
/** SMSGate message id (OpenAPI: string, maxLength 36). */
export const GATEWAY_ID_RE = /^[A-Za-z0-9_-]{1,36}$/;

export interface SmsItem {
  id: string;
  phone: string;
  text: string;
}

export type ProxyRequest =
  | { action: 'status' }
  | { action: 'send'; messages: SmsItem[] }
  | { action: 'messageStatus'; ids: string[] };

export type ValidationCode =
  | 'invalid_json'
  | 'invalid_action'
  | 'no_recipients'
  | 'too_many_recipients'
  | 'invalid_item'
  | 'no_ids'
  | 'too_many_ids'
  | 'invalid_id';

export type ValidationResult =
  | { ok: true; value: ProxyRequest }
  | { ok: false; error: ValidationCode; details?: string[] };

/**
 * Validates a parsed JSON body. Error details reference item indexes/ids only — never phones or text.
 */
export function validateProxyRequest(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_json' };
  const b = body as Record<string, unknown>;
  if (b.action === 'status') return { ok: true, value: { action: 'status' } };
  if (b.action === 'messageStatus') {
    const ids = b.ids;
    if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'no_ids' };
    if (ids.length > MAX_STATUS_IDS) return { ok: false, error: 'too_many_ids', details: [`max ${MAX_STATUS_IDS}`] };
    const bad: string[] = [];
    const seenIds = new Set<string>();
    ids.forEach((id, i) => {
      if (typeof id !== 'string' || !GATEWAY_ID_RE.test(id)) bad.push(`#${i}: invalid id`);
      else if (seenIds.has(id)) bad.push(`#${i}: duplicate id`);
      else seenIds.add(id);
    });
    if (bad.length) return { ok: false, error: 'invalid_id', details: bad };
    return { ok: true, value: { action: 'messageStatus', ids: ids as string[] } };
  }
  if (b.action !== 'send') return { ok: false, error: 'invalid_action' };

  const messages = b.messages;
  if (!Array.isArray(messages) || messages.length === 0) return { ok: false, error: 'no_recipients' };
  if (messages.length > MAX_RECIPIENTS_PER_CALL) {
    return { ok: false, error: 'too_many_recipients', details: [`max ${MAX_RECIPIENTS_PER_CALL}`] };
  }

  const details: string[] = [];
  const seen = new Set<string>();
  const clean: SmsItem[] = [];
  messages.forEach((m, i) => {
    if (!m || typeof m !== 'object') {
      details.push(`#${i}: not an object`);
      return;
    }
    const { id, phone, text } = m as Record<string, unknown>;
    if (typeof id !== 'string' || !ITEM_ID_RE.test(id)) details.push(`#${i}: invalid id`);
    else if (seen.has(id)) details.push(`#${i}: duplicate id`);
    if (typeof phone !== 'string' || !PHONE_RE.test(phone)) details.push(`#${i}: invalid phone`);
    if (typeof text !== 'string' || !text.trim()) details.push(`#${i}: empty text`);
    else if ([...text].length > MAX_BODY_CHARS) details.push(`#${i}: text too long`);
    if (typeof id === 'string') seen.add(id);
    if (typeof id === 'string' && typeof phone === 'string' && typeof text === 'string') clean.push({ id, phone, text });
  });
  if (details.length) return { ok: false, error: 'invalid_item', details };
  return { ok: true, value: { action: 'send', messages: clean } };
}

/** Origins allowed to call the function from a browser. */
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  if (origin === 'https://mhzcis.github.io') return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin);
}
