/**
 * Matches names from an uploaded list to registered students.
 * - Only an EXACT match on the normalised full name (Arabic or English) is auto-selected.
 * - Several exact matches (duplicate names) or partial/token matches are returned as
 *   `ambiguous` with candidates for a manual choice; they are never auto-picked.
 */
import type { Student } from '../types';

export function normalizeName(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '') // diacritics
    .replace(/\u0640/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface AmbiguousMatch {
  raw: string;
  candidateIds: string[];
  reason: 'duplicate' | 'partial';
}

export interface NameMatchResult {
  matched: Array<{ raw: string; studentId: string }>;
  ambiguous: AmbiguousMatch[];
  unmatched: string[];
  /** Unique matched student ids (in order). */
  matchedIds: string[];
}

const MAX_CANDIDATES = 10;

function tokens(s: string): string[] {
  return s.split(' ').filter(Boolean);
}

/** True if every token of `a` appears, in order, among the tokens of `b`. */
function tokensContainedInOrder(a: string[], b: string[]): boolean {
  let j = 0;
  for (const t of a) {
    while (j < b.length && b[j] !== t) j++;
    if (j === b.length) return false;
    j++;
  }
  return true;
}

export function matchNames(rawNames: string[], students: Student[]): NameMatchResult {
  const index = students.map(s => ({
    s,
    ar: normalizeName(s.name),
    en: normalizeName(s.nameEn),
  }));
  const result: NameMatchResult = { matched: [], ambiguous: [], unmatched: [], matchedIds: [] };

  for (const raw of rawNames) {
    const n = normalizeName(raw);
    if (!n) continue;
    const exact = index.filter(x => x.ar === n || (x.en && x.en === n));
    if (exact.length === 1) {
      const id = exact[0].s.id;
      result.matched.push({ raw, studentId: id });
      if (!result.matchedIds.includes(id)) result.matchedIds.push(id);
      continue;
    }
    if (exact.length > 1) {
      result.ambiguous.push({ raw, candidateIds: exact.map(x => x.s.id).slice(0, MAX_CANDIDATES), reason: 'duplicate' });
      continue;
    }
    const rt = tokens(n);
    const partial = index.filter(x => {
      for (const name of [x.ar, x.en]) {
        if (!name) continue;
        const st = tokens(name);
        if (tokensContainedInOrder(rt, st) || tokensContainedInOrder(st, rt)) return true;
      }
      return false;
    });
    if (partial.length > 0) {
      result.ambiguous.push({ raw, candidateIds: partial.map(x => x.s.id).slice(0, MAX_CANDIDATES), reason: 'partial' });
    } else {
      result.unmatched.push(raw);
    }
  }
  return result;
}
