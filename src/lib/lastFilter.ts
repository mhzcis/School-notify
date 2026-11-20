/**
 * Remembers the last grade/section filter (and the dashboard search) in non-sensitive `sn_*`
 * localStorage keys. Never stores selected students, phones, or message text.
 * Values that no longer exist in the current student list are ignored on read.
 */
import { readPref, UI_PREF_KEYS, writePref } from './smsPrefs';

export const LAST_FILTER_KEYS = {
  compose: UI_PREF_KEYS.lastFilterCompose,
  dashboard: UI_PREF_KEYS.lastFilterDashboard,
} as const;

export type ComposeTargetType = 'all' | 'grade' | 'section';

export interface ComposeFilter {
  targetType: ComposeTargetType;
  grade: string;
  section: string;
}

export interface DashboardFilter {
  grade: string; // 'all' or a grade
  section: string; // 'all' or a section
  search: string;
}

const MAX_SEARCH = 100;

function parse(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

export function readComposeFilter(): ComposeFilter {
  const v = parse(readPref(LAST_FILTER_KEYS.compose));
  const t = v?.targetType;
  // 'custom' (hand-picked students) is never restored: selection always starts empty.
  const targetType: ComposeTargetType = t === 'grade' || t === 'section' ? t : 'all';
  return { targetType, grade: str(v?.grade), section: str(v?.section) };
}

export function writeComposeFilter(f: Omit<Partial<ComposeFilter>, 'targetType'> & { targetType?: string }): void {
  const cur = readComposeFilter();
  const t = f.targetType;
  const next: ComposeFilter = {
    targetType: t === 'grade' || t === 'section' || t === 'all' ? t : cur.targetType,
    grade: f.grade !== undefined ? str(f.grade) : cur.grade,
    section: f.section !== undefined ? str(f.section) : cur.section,
  };
  writePref(LAST_FILTER_KEYS.compose, JSON.stringify(next));
}

export function readDashboardFilter(): DashboardFilter {
  const v = parse(readPref(LAST_FILTER_KEYS.dashboard));
  return {
    grade: str(v?.grade) || 'all',
    section: str(v?.section) || 'all',
    search: str(v?.search, MAX_SEARCH),
  };
}

export function writeDashboardFilter(f: Partial<DashboardFilter>): void {
  const cur = readDashboardFilter();
  const next: DashboardFilter = {
    grade: f.grade !== undefined ? str(f.grade) || 'all' : cur.grade,
    section: f.section !== undefined ? str(f.section) || 'all' : cur.section,
    search: f.search !== undefined ? str(f.search, MAX_SEARCH) : cur.search,
  };
  writePref(LAST_FILTER_KEYS.dashboard, JSON.stringify(next));
}

/** Returns `value` if it is one of `options` (or the 'all' sentinel when allowed), else the fallback. */
export function validOption(value: string, options: string[], fallback: string, allowAll = false): string {
  if (allowAll && value === 'all') return value;
  return value && options.includes(value) ? value : fallback;
}
