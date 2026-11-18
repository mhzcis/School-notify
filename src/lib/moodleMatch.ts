/**
 * Match Moodle export rows to registered students.
 * National ID wins, then Moodle user id (when stored on the student), then
 * an exact unique name. Ambiguous or partial name hits are never auto-picked.
 */
import type { Student } from '../types';
import { isDraft, isNeverLoggedIn, isNotAttempted, isNotSince, isNotSubmitted, type MoodleRow } from './moodleCsv';
import { matchNames } from './nameMatching';
import { matchStudentsByNationalIds } from './nationalIds';

export type MoodleMatchHow = 'national_id' | 'moodle_user_id' | 'name';

export interface MoodleMatched {
  row: MoodleRow;
  studentId: string;
  how: MoodleMatchHow;
}

export interface MoodleAmbiguous {
  row: MoodleRow;
  candidateIds: string[];
  reason: 'duplicate' | 'partial';
}

export interface MoodleMatchResult {
  matched: MoodleMatched[];
  ambiguous: MoodleAmbiguous[];
  unmatched: MoodleRow[];
  /** Unique matched student ids, first-seen order. */
  matchedIds: string[];
}

/**
 * Optional Moodle user id stored on the student (extra.moodleUserId). Not a credential.
 * We never read moodleUsername as an id here.
 */
function studentMoodleUserId(s: Student): string {
  const extra = (s as Student & { moodleUserId?: string }).moodleUserId;
  return String(extra ?? '').trim();
}

export function matchMoodleRows(rows: MoodleRow[], students: Student[]): MoodleMatchResult {
  const byMid = new Map<string, string[]>();
  for (const s of students) {
    const mid = studentMoodleUserId(s);
    if (mid) {
      const arr = byMid.get(mid) ?? [];
      arr.push(s.id);
      byMid.set(mid, arr);
    }
  }

  const result: MoodleMatchResult = { matched: [], ambiguous: [], unmatched: [], matchedIds: [] };
  const seenStudent = new Set<string>();

  const addMatched = (row: MoodleRow, studentId: string, how: MoodleMatchHow) => {
    result.matched.push({ row, studentId, how });
    if (!seenStudent.has(studentId)) {
      seenStudent.add(studentId);
      result.matchedIds.push(studentId);
    }
  };

  const namePending: MoodleRow[] = [];

  for (const row of rows) {
    if (row.nationalId) {
      const hit = matchStudentsByNationalIds(students, [row.nationalId]);
      if (hit.matchedIds.length === 1) {
        addMatched(row, hit.matchedIds[0], 'national_id');
        continue;
      }
    }
    if (row.moodleUserId) {
      const ids = byMid.get(row.moodleUserId) ?? [];
      const unique = [...new Set(ids)];
      if (unique.length === 1) {
        addMatched(row, unique[0], 'moodle_user_id');
        continue;
      }
      if (unique.length > 1) {
        result.ambiguous.push({ row, candidateIds: unique.slice(0, 10), reason: 'duplicate' });
        continue;
      }
    }
    if (row.fullName) {
      namePending.push(row);
      continue;
    }
    result.unmatched.push(row);
  }

  for (const row of namePending) {
    const names = matchNames([row.fullName!], students);
    if (names.matched.length === 1) {
      addMatched(row, names.matched[0].studentId, 'name');
    } else if (names.ambiguous.length) {
      result.ambiguous.push({
        row,
        candidateIds: names.ambiguous[0].candidateIds,
        reason: names.ambiguous[0].reason,
      });
    } else {
      result.unmatched.push(row);
    }
  }

  return result;
}

export function resolveAmbiguous(result: MoodleMatchResult, rowIndexInAmbiguous: number, studentId: string): MoodleMatchResult {
  const ambiguous = result.ambiguous.slice();
  const picked = ambiguous.splice(rowIndexInAmbiguous, 1)[0];
  if (!picked || !picked.candidateIds.includes(studentId)) return result;
  const matched = result.matched.concat([{ row: picked.row, studentId, how: 'name' }]);
  const matchedIds = result.matchedIds.includes(studentId) ? result.matchedIds.slice() : result.matchedIds.concat(studentId);
  return { matched, ambiguous, unmatched: result.unmatched.slice(), matchedIds };
}

export interface SectionCounts {
  label: string;
  neverLoggedIn: string[];
  notSince: string[];
  notSubmitted: string[];
  draft: string[];
  notAttempted: string[];
}

export function sectionLabel(grade?: string, section?: string): string {
  const g = String(grade ?? '').trim();
  const s = String(section ?? '').trim();
  if (!g) return s;
  if (!s) return g;
  if (s === g || s.startsWith(g + ' ') || s.startsWith(g + '/')) return s;
  return `${g} ${s}`;
}

export function countBySection(
  matched: MoodleMatched[],
  students: Student[],
  opts: { notSinceDays?: number; now?: Date } = {},
): SectionCounts[] {
  const byId = new Map(students.map(s => [s.id, s]));
  const map = new Map<string, SectionCounts>();
  const days = opts.notSinceDays ?? 7;
  const now = opts.now ?? new Date();
  for (const m of matched) {
    const s = byId.get(m.studentId);
    const label = s ? sectionLabel(s.grade, s.section) : (m.row.section || 'غير محدد');
    let rec = map.get(label);
    if (!rec) {
      rec = { label, neverLoggedIn: [], notSince: [], notSubmitted: [], draft: [], notAttempted: [] };
      map.set(label, rec);
    }
    if (isNeverLoggedIn(m.row) && !rec.neverLoggedIn.includes(m.studentId)) rec.neverLoggedIn.push(m.studentId);
    if (isNotSince(m.row, days, now) && !rec.notSince.includes(m.studentId)) rec.notSince.push(m.studentId);
    if (isNotSubmitted(m.row) && !rec.notSubmitted.includes(m.studentId)) rec.notSubmitted.push(m.studentId);
    if (isDraft(m.row) && !rec.draft.includes(m.studentId)) rec.draft.push(m.studentId);
    if (isNotAttempted(m.row) && !rec.notAttempted.includes(m.studentId)) rec.notAttempted.push(m.studentId);
  }
  return [...map.values()];
}
