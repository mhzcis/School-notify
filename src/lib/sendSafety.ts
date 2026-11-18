/**
 * Pre-send safety helpers: large-send typed confirm, quiet hours, 24h duplicate warning.
 * Pure functions — clock can be injected. Fake fixtures only in tests.
 */
import type { MessageLog } from '../types';
import { checkPhone } from './phone';

/** Typed-count confirm is required when this many messages (valid numbers) will go out. */
export const LARGE_SEND_THRESHOLD = 30;

/** Quiet hours in Asia/Jerusalem: 22:00 inclusive through 07:00 exclusive. */
export const QUIET_HOURS_TIME_ZONE = 'Asia/Jerusalem';
export const QUIET_HOURS_START = 22; // 22:00
export const QUIET_HOURS_END = 7; // 07:00
export const QUIET_HOURS_LABEL = '10 مساءً – 7 صباحاً (توقيت القدس)';

export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Hour 0–23 in the given IANA time zone. */
export function hourInTimeZone(at: Date, timeZone: string = QUIET_HOURS_TIME_ZONE): number {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(at)
  );
  return Number.isFinite(hour) ? hour : at.getHours();
}

/** True when `at` falls in [22:00, 07:00) in Asia/Jerusalem. */
export function isQuietHours(at: Date = new Date(), timeZone: string = QUIET_HOURS_TIME_ZONE): boolean {
  const hour = hourInTimeZone(at, timeZone);
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

export function requiresTypedCount(messageCount: number, threshold: number = LARGE_SEND_THRESHOLD): boolean {
  return messageCount >= threshold;
}

export function typedCountMatches(typed: string, expected: number): boolean {
  const raw = String(typed).trim();
  if (!/^\d+$/.test(raw)) return false;
  return Number(raw) === expected;
}

export interface DuplicateHit {
  phone: string;
  count: number;
}

/**
 * Warn (do not block) when the same normalised phone received the same rendered body
 * in the last 24 hours. Compares against stored logs. Never requires printing real numbers
 * in the UI beyond a count (callers should not list the phones).
 */
export function findDuplicateSends(
  items: Array<{ phone: string; content: string }>,
  logs: MessageLog[],
  now: Date = new Date(),
  windowMs: number = DUPLICATE_WINDOW_MS
): DuplicateHit[] {
  const windowStart = now.getTime() - windowMs;
  const prior = new Map<string, number>();
  for (const l of logs) {
    if (l.status === 'failed') continue;
    const t = Date.parse(l.sentTime);
    if (!Number.isFinite(t) || t < windowStart) continue;
    const phone = checkPhone(l.phone).valid ? checkPhone(l.phone).local : String(l.phone || '').trim();
    if (!phone) continue;
    const key = `${phone}\n${l.messageContent ?? ''}`;
    prior.set(key, (prior.get(key) ?? 0) + 1);
  }
  const hits: DuplicateHit[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const phone = checkPhone(item.phone).valid ? checkPhone(item.phone).local : String(item.phone || '').trim();
    if (!phone) continue;
    const key = `${phone}\n${item.content ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const count = prior.get(key) ?? 0;
    if (count > 0) hits.push({ phone, count });
  }
  return hits;
}

export function duplicateWarningCount(hits: DuplicateHit[]): number {
  return hits.reduce((n, h) => n + h.count, 0);
}
