import { buildSendBody } from './encryption.ts';
/**
 * SMSGate cloud API calls (pure: fetch is injected so this runs in Deno and in vitest).
 * Based on the SMSGate OpenAPI spec (https://api.sms-gate.app/docs/doc.json):
 *   POST /3rdparty/v1/messages       -> 202 GetMessageResponse { id, state, recipients[] }
 *   GET  /3rdparty/v1/messages/{id}  -> 200 GetMessageResponse { id, deviceId, state, recipients[{ phoneNumber, state, error? }] }
 *   ProcessingState: Pending | Cancelling | Cancelled | Processed | Sent | Delivered | Failed
 * Never returns or logs phone numbers, message bodies or credentials.
 */
import type { SmsItem } from './validate.ts';

export const SMSGATE_BASE = 'https://api.sms-gate.app/3rdparty/v1';
/** Send endpoint kept as already used in production (legacy singular path still accepted by the cloud). */
export const SMSGATE_SEND_URL = `${SMSGATE_BASE}/message`;
export const SMSGATE_STATUS_URL = (id: string) => `${SMSGATE_BASE}/messages/${encodeURIComponent(id)}`;
export const GATEWAY_TIMEOUT_MS = 15_000;

export const GATEWAY_STATES = ['Pending', 'Cancelling', 'Cancelled', 'Processed', 'Sent', 'Delivered', 'Failed'] as const;
export type GatewayState = (typeof GATEWAY_STATES)[number] | 'Unknown';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ItemResult {
  id: string;
  ok: boolean;
  error?: string;
  gatewayMessageId?: string;
}

export interface StatusResult {
  id: string;
  state: GatewayState;
  /** Short gateway error text for failed recipients (e.g. "timeout"); never a phone number. */
  error?: string;
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function sendOne(
  item: SmsItem,
  auth: string,
  f: FetchLike,
  passphrase?: string
): Promise<ItemResult & { authFailed?: boolean }> {
  let body: string;
  try {
    body = JSON.stringify(await buildSendBody(item.text, item.phone, passphrase));
  } catch {
    // Fail closed: never fall back to plaintext when encryption is configured.
    return { id: item.id, ok: false, error: 'encryption_failed' };
  }
  try {
    return await withTimeout(async signal => {
      const res = await f(SMSGATE_SEND_URL, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body,
        signal,
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
    });
  } catch (err) {
    return { id: item.id, ok: false, error: (err as Error)?.name === 'AbortError' ? 'gateway_timeout' : 'gateway_unreachable' };
  }
}

/** Extracts state + sanitized error from a GetMessageResponse body. Drops phoneNumber fields. */
export function parseMessageState(id: string, body: unknown): StatusResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const state = (GATEWAY_STATES as readonly string[]).includes(b.state as string) ? (b.state as GatewayState) : 'Unknown';
  let error: string | undefined;
  if (Array.isArray(b.recipients)) {
    for (const r of b.recipients) {
      const e = r && typeof r === 'object' ? (r as Record<string, unknown>).error : undefined;
      if (typeof e === 'string' && e.trim()) {
        // Keep it short and strip anything that looks like a phone number.
        error = e.replace(/\+?\d{7,}/g, '***').slice(0, 120);
        break;
      }
    }
  }
  return error ? { id, state, error } : { id, state };
}

export async function statusOne(id: string, auth: string, f: FetchLike): Promise<StatusResult & { authFailed?: boolean }> {
  try {
    return await withTimeout(async signal => {
      const res = await f(SMSGATE_STATUS_URL(id), { method: 'GET', headers: { Authorization: auth }, signal });
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel();
        return { id, state: 'Unknown' as const, error: 'gateway_auth_failed', authFailed: true };
      }
      if (res.status === 404) {
        await res.body?.cancel();
        return { id, state: 'Unknown' as const, error: 'not_found' };
      }
      if (!res.ok) {
        await res.body?.cancel();
        return { id, state: 'Unknown' as const, error: 'gateway_rejected' };
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* ignore */
      }
      return parseMessageState(id, body);
    });
  } catch (err) {
    return { id, state: 'Unknown', error: (err as Error)?.name === 'AbortError' ? 'gateway_timeout' : 'gateway_unreachable' };
  }
}

export async function statusMany(ids: string[], auth: string, f: FetchLike): Promise<StatusResult[]> {
  const out: StatusResult[] = [];
  let authFailed = false;
  for (const id of ids) {
    if (authFailed) {
      out.push({ id, state: 'Unknown', error: 'gateway_auth_failed' });
      continue;
    }
    const r = await statusOne(id, auth, f);
    if (r.authFailed) authFailed = true;
    out.push(r.error ? { id: r.id, state: r.state, error: r.error } : { id: r.id, state: r.state });
  }
  return out;
}
