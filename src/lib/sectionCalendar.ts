/**
 * Weekly calendar helpers for per-section quiz/assignment close dates.
 * Weeks start on Sunday (school week) in Asia/Jerusalem. Pure functions; clock injectable.
 */
import type { Student } from '../types';
import { sectionLabel } from './moodleMatch';
import type { SectionEvent } from './sectionEvents';

export const CAL_TIME_ZONE = 'Asia/Jerusalem';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Y-M-D of `d` in Asia/Jerusalem. */
export function localYmd(d: Date, timeZone = CAL_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Weekday 0 (Sunday) – 6 in Asia/Jerusalem. */
export function localWeekday(d: Date, timeZone = CAL_TIME_ZONE): number {
  const w = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w);
}

/** The 7 local dates (YYYY-MM-DD) of the week containing `now`, shifted by `offsetWeeks`. */
export function weekDays(now: Date, offsetWeeks = 0): string[] {
  const noon = new Date(`${localYmd(now)}T12:00:00Z`);
  const start = new Date(noon.getTime() - localWeekday(now) * DAY_MS + offsetWeeks * 7 * DAY_MS);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10));
}

export interface CalendarEntry {
  event: SectionEvent;
  day: string; // YYYY-MM-DD local close day
  reminderDay: string; // day before
}

/** Events with a parseable closeAt that falls inside `days`, sorted by close time. */
export function eventsForDays(events: SectionEvent[], days: string[]): CalendarEntry[] {
  const set = new Set(days);
  const out: CalendarEntry[] = [];
  for (const e of events) {
    if (!e.closeAt) continue;
    const d = new Date(e.closeAt);
    if (!Number.isFinite(d.getTime())) continue;
    const day = localYmd(d);
    if (!set.has(day)) continue;
    out.push({ event: e, day, reminderDay: localYmd(new Date(d.getTime() - DAY_MS)) });
  }
  return out.sort((a, b) => a.event.closeAt.localeCompare(b.event.closeAt));
}

/** Events without a usable date (shown separately so they are not lost). */
export function undatedEvents(events: SectionEvent[]): SectionEvent[] {
  return events.filter(e => !e.closeAt || !Number.isFinite(new Date(e.closeAt).getTime()));
}

/** National IDs of the students in the event's section (grade + section, or label match). */
export function sectionStudentIds(e: Pick<SectionEvent, 'grade' | 'section'>, students: Student[]): string[] {
  const label = sectionLabel(e.grade, e.section);
  return students
    .filter(s => (e.grade ? s.grade === e.grade && s.section === e.section : s.section === e.section) || sectionLabel(s.grade, s.section) === label)
    .map(s => s.id);
}
