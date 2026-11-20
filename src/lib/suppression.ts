/**
 * Do-not-send list (suppression list). Phones are stored in local form 05XXXXXXXX with a
 * short reason. Every dispatch path (composer send, resend-failed, scheduled server sends)
 * skips these numbers and the confirm dialog shows how many were excluded.
 */
import { checkPhone } from './phone';

export interface SuppressedPhone {
  phone: string; // local 05XXXXXXXX
  reason: string;
  createdAt?: string;
}

export const MAX_REASON_LEN = 200;

export type SuppressionParse =
  | { ok: true; entry: SuppressedPhone }
  | { ok: false; error: 'invalid_phone' };

export function parseSuppressed(rawPhone: string, reason: string): SuppressionParse {
  const c = checkPhone(rawPhone);
  if (!c.valid) return { ok: false, error: 'invalid_phone' };
  return { ok: true, entry: { phone: c.local, reason: String(reason ?? '').trim().slice(0, MAX_REASON_LEN) } };
}

/** Normalised set for fast lookups (invalid rows are ignored). */
export function suppressionSet(list: Array<{ phone: string }> | undefined | null): Set<string> {
  const s = new Set<string>();
  for (const r of list ?? []) {
    const c = checkPhone(r.phone);
    if (c.valid) s.add(c.local);
  }
  return s;
}

export function isSuppressed(rawPhone: unknown, set: Set<string>): boolean {
  if (!set.size) return false;
  const c = checkPhone(rawPhone);
  return c.valid && set.has(c.local);
}

/** Masks a phone for display in lists that might be screenshotted: 059****123. */
export function maskPhone(local: string): string {
  return local.length >= 7 ? `${local.slice(0, 3)}****${local.slice(-3)}` : local;
}

/** Validates an untrusted list (backup file): keeps valid, de-duplicated entries only. */
export function parseSuppressedList(raw: unknown): SuppressedPhone[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, SuppressedPhone>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const p = parseSuppressed(String((r as any).phone ?? ''), String((r as any).reason ?? ''));
    if (p.ok) out.set(p.entry.phone, p.entry);
  }
  return [...out.values()];
}
