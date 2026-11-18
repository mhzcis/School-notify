/**
 * Per-section quiz / assignment windows used for {{رابط_الاختبار}} and {{موعد_الإغلاق}},
 * and for the WhatsApp section-blurb generator. Not stored on the student row.
 */
import { newId } from './repo/mapping';
import { sectionLabel } from './moodleMatch';

export const QUIZ_LAUNCHER_BASE = 'https://mhzcis.github.io/moodle-quiz-launcher/';
export const LOCAL_SECTION_EVENTS_KEY = 'sn_section_events';

export type SectionEventType = 'quiz' | 'assignment';

export interface SectionEvent {
  id: string;
  grade: string;
  section: string;
  type: SectionEventType;
  title: string;
  /** ISO timestamp when known; empty if the teacher only typed a label. */
  closeAt: string;
  /** Teacher-facing close text (shown in messages), e.g. "الخميس 12/11/2026 الساعة 11:59 مساءً". */
  closeLabel: string;
  /** Full per-section launcher URL. */
  url: string;
  duration: string;
  attempts: string;
  updatedAt: string;
}

export function buildQuizLauncherUrl(idOrUrl: string): string {
  const raw = String(idOrUrl ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const id = (u.searchParams.get('id') || '').trim();
    if (/^\d+$/.test(id)) return `${QUIZ_LAUNCHER_BASE}?id=${id}`;
    // Unknown URL: keep it as the teacher entered it (do not invent a section link).
    return raw;
  } catch {
    if (/^\d+$/.test(raw)) return `${QUIZ_LAUNCHER_BASE}?id=${raw}`;
    return raw;
  }
}

export function extractLauncherQuizId(url: string): string {
  const built = buildQuizLauncherUrl(url);
  try {
    return new URL(built).searchParams.get('id') || '';
  } catch {
    return '';
  }
}

export function eventLabel(e: Pick<SectionEvent, 'grade' | 'section'>): string {
  return sectionLabel(e.grade, e.section);
}

export function findSectionEvent(
  events: SectionEvent[],
  grade: string,
  section: string,
  type: SectionEventType = 'quiz',
): SectionEvent | undefined {
  const label = sectionLabel(grade, section);
  const ofType = events.filter(e => e.type === type);
  return (
    ofType.find(e => e.grade === grade && e.section === section)
    || ofType.find(e => eventLabel(e) === label)
    || ofType.find(e => e.section === section && !e.grade)
  );
}

export function formatCloseDate(e: Pick<SectionEvent, 'closeAt' | 'closeLabel'>, locale = 'ar-EG'): string {
  if (e.closeLabel && e.closeLabel.trim()) return e.closeLabel.trim();
  if (!e.closeAt) return '';
  const d = new Date(e.closeAt);
  if (!Number.isFinite(d.getTime())) return e.closeAt;
  return d.toLocaleString(locale, {
    timeZone: 'Asia/Jerusalem',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildSectionEvent(partial: Partial<SectionEvent> & { grade?: string; section?: string }, now = new Date()): SectionEvent {
  return {
    id: partial.id || newId(),
    grade: String(partial.grade ?? '').trim(),
    section: String(partial.section ?? '').trim(),
    type: partial.type === 'assignment' ? 'assignment' : 'quiz',
    title: String(partial.title ?? '').trim(),
    closeAt: String(partial.closeAt ?? '').trim(),
    closeLabel: String(partial.closeLabel ?? '').trim(),
    url: buildQuizLauncherUrl(String(partial.url ?? '').trim()),
    duration: String(partial.duration ?? '').trim(),
    attempts: String(partial.attempts ?? '').trim(),
    updatedAt: partial.updatedAt || now.toISOString(),
  };
}

export function parseSectionEvents(value: unknown): SectionEvent[] {
  if (!Array.isArray(value)) return [];
  return value.map(v => buildSectionEvent(v as Partial<SectionEvent>)).filter(e => e.grade || e.section || e.url || e.title);
}

export function readLocalSectionEvents(): SectionEvent[] {
  try {
    const raw = localStorage.getItem(LOCAL_SECTION_EVENTS_KEY);
    return raw ? parseSectionEvents(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function writeLocalSectionEvents(events: SectionEvent[]): void {
  try {
    localStorage.setItem(LOCAL_SECTION_EVENTS_KEY, JSON.stringify(parseSectionEvents(events)));
  } catch { /* ignore quota */ }
}
