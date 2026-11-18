/**
 * Pure decision logic for server-side scheduled sending.
 * Nothing in this module sends an SMS. The Edge Function and the UI both use it.
 *
 * Automatic sending stays off until every kill switch is enabled after deploy.
 */
import { isQuietHours, QUIET_HOURS_TIME_ZONE } from './sendSafety';
import { templateUsesSecrets } from './template';
import type { MessageLog, ScheduledMessage, Student } from '../types';
import { checkPhone } from './phone';

export const SCHEDULER_TIME_ZONE = QUIET_HOURS_TIME_ZONE;
export const DEFAULT_MAX_PER_RUN = 50;
export const DEFAULT_MAX_CAMPAIGNS_PER_RUN = 3;
export const STUCK_SENDING_MS = 15 * 60 * 1000;
/** The teacher must type this exact word in the UI to enable auto-send. */
export const TYPED_ENABLE_WORD = 'تفعيل';

export interface SchedulerSettings {
  available: boolean;
  enabled: boolean;
  maxPerRun: number;
}

export function defaultSchedulerSettings(): SchedulerSettings {
  return { available: false, enabled: false, maxPerRun: DEFAULT_MAX_PER_RUN };
}

export function typedEnableMatches(typed: string): boolean {
  return String(typed).trim() === TYPED_ENABLE_WORD;
}

/** Offset of `timeZone` at `utcMillis`, in milliseconds (e.g. +2h in winter). */
export function timeZoneOffsetMs(utcMillis: number, timeZone: string = SCHEDULER_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcMillis));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMillis;
}

/**
 * Parse a campaign scheduledTime. Naive values (no Z / offset) are Asia/Jerusalem
 * wall time, which is how the composer stores them.
 */
export function parseScheduledTime(raw: string): Date | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/[zZ]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = Number(m[6] || '0');
  const wallAsUtc = Date.UTC(y, mo - 1, d, hh, mm, ss);
  let utc = wallAsUtc - timeZoneOffsetMs(wallAsUtc, SCHEDULER_TIME_ZONE);
  const adjusted = timeZoneOffsetMs(utc, SCHEDULER_TIME_ZONE);
  if (adjusted !== timeZoneOffsetMs(wallAsUtc, SCHEDULER_TIME_ZONE)) {
    utc = wallAsUtc - adjusted;
  }
  return new Date(utc);
}

export function isCampaignDue(campaign: Pick<ScheduledMessage, 'status' | 'scheduledTime' | 'archived'>, now: Date = new Date(), stuckAfterMs = STUCK_SENDING_MS): boolean {
  if (campaign.archived) return false;
  if (campaign.status === 'cancelled' || campaign.status === 'completed') return false;
  const when = parseScheduledTime(campaign.scheduledTime);
  if (!when || when.getTime() > now.getTime()) return false;
  if (campaign.status === 'pending') return true;
  if (campaign.status === 'sending') {
    // Stuck claim recovery is decided by the caller (claimedAt). Treat sending as not due here.
    return false;
  }
  return false;
}

export function isStuckSending(claimedAt: string | undefined, now: Date = new Date(), stuckAfterMs = STUCK_SENDING_MS): boolean {
  if (!claimedAt) return true;
  const t = Date.parse(claimedAt);
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t >= stuckAfterMs;
}

export function shouldSkipQuietHours(
  campaign: Pick<ScheduledMessage, 'quietHoursOverride'>,
  now: Date = new Date(),
): boolean {
  if (campaign.quietHoursOverride) return false;
  return isQuietHours(now, SCHEDULER_TIME_ZONE);
}

/** Secret templates are not auto-sent unless the teacher confirmed at schedule time. */
export function blocksAutosendForCredentials(contentTemplate: string, allowCredentialsAutosend?: boolean): boolean {
  return templateUsesSecrets(contentTemplate) && !allowCredentialsAutosend;
}

export function resolveTargets(
  campaign: Pick<ScheduledMessage, 'targetType' | 'targetGrade' | 'targetSection' | 'targetStudentIds'>,
  students: Student[],
): Student[] {
  if (campaign.targetType === 'grade') return students.filter(s => s.grade === campaign.targetGrade);
  if (campaign.targetType === 'section') {
    return students.filter(s => s.grade === campaign.targetGrade && s.section === campaign.targetSection);
  }
  if (campaign.targetType === 'custom' && campaign.targetStudentIds?.length) {
    const set = new Set(campaign.targetStudentIds);
    return students.filter(s => set.has(s.id));
  }
  if (campaign.targetType === 'all') return [...students];
  return [];
}

export function alreadySentKeys(logs: Array<Pick<MessageLog, 'campaignId' | 'phone' | 'studentId' | 'status'>>, campaignId: string): Set<string> {
  const keys = new Set<string>();
  for (const l of logs) {
    if (l.campaignId !== campaignId) continue;
    if (l.status === 'failed') continue; // may be retried
    const phone = checkPhone(l.phone).valid ? checkPhone(l.phone).local : String(l.phone || '').trim();
    keys.add(`${l.studentId}|${phone}`);
  }
  return keys;
}

export function dispatchKey(studentId: string, phone: string): string {
  const p = checkPhone(phone).valid ? checkPhone(phone).local : String(phone || '').trim();
  return `${studentId}|${p}`;
}

export function remainingItems<T extends { studentId: string; phone: string }>(items: T[], sent: Set<string>): T[] {
  return items.filter(i => !sent.has(dispatchKey(i.studentId, i.phone)));
}

export function sliceForRun<T>(items: T[], maxPerRun: number = DEFAULT_MAX_PER_RUN): T[] {
  const n = Math.max(0, Math.min(Number(maxPerRun) || 0, 200));
  return items.slice(0, n);
}

export type SchedulerSkipReason =
  | 'disabled'
  | 'not_due'
  | 'quiet_hours'
  | 'credentials'
  | 'already_sent'
  | 'no_recipients';

export function evaluateCampaign(
  campaign: ScheduledMessage,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: SchedulerSkipReason } {
  if (!isCampaignDue(campaign, now)) return { ok: false, reason: 'not_due' };
  if (shouldSkipQuietHours(campaign, now)) return { ok: false, reason: 'quiet_hours' };
  if (blocksAutosendForCredentials(campaign.contentTemplate, campaign.allowCredentialsAutosend)) {
    return { ok: false, reason: 'credentials' };
  }
  return { ok: true };
}
