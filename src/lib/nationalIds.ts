/**
 * Parse pasted / uploaded national IDs and match them to students.
 * A bad or empty paste must never select the whole school.
 */
import type { Student } from '../types';
import { toAsciiDigits } from './phone';

/** All national-ID tokens (4–15 digits) in order, including duplicates. Arabic-Indic digits allowed. */
export function tokenizeNationalIds(raw: string): string[] {
  if (!raw) return [];
  const text = toAsciiDigits(String(raw));
  return text.split(/[^\d]+/).map(s => s.trim()).filter(s => s.length >= 4 && s.length <= 15);
}

/** Unique national-ID tokens from pasted text or a file column, first-seen order. */
export function parseNationalIds(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of tokenizeNationalIds(raw)) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

export interface NationalIdMatchResult {
  matchedIds: string[];
  unknownIds: string[];
  /** IDs that appeared more than once in the paste (still matched once). */
  duplicateIds: string[];
}

function studentIdKey(s: Student): string[] {
  const keys = [s.id, s.idNumber].map(v => toAsciiDigits(String(v ?? '')).trim()).filter(Boolean);
  return [...new Set(keys)];
}

/**
 * Matches pasted IDs to students by `id` or `idNumber`. Unknown IDs are reported.
 * An empty parse yields empty matchedIds (never "select all").
 */
export function matchStudentsByNationalIds(students: Student[], rawOrIds: string | string[]): NationalIdMatchResult {
  const tokens = Array.isArray(rawOrIds)
    ? rawOrIds.flatMap(v => tokenizeNationalIds(String(v)))
    : tokenizeNationalIds(rawOrIds);

  const counts = new Map<string, number>();
  const unique: string[] = [];
  for (const id of tokens) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (counts.get(id) === 1) unique.push(id);
  }

  const byKey = new Map<string, string>();
  for (const s of students) {
    for (const k of studentIdKey(s)) byKey.set(k, s.id);
  }

  const matchedIds: string[] = [];
  const unknownIds: string[] = [];
  const matchedStudent = new Set<string>();
  for (const id of unique) {
    const studentId = byKey.get(id);
    if (!studentId) {
      unknownIds.push(id);
      continue;
    }
    if (!matchedStudent.has(studentId)) {
      matchedStudent.add(studentId);
      matchedIds.push(studentId);
    }
  }
  const duplicateIds = unique.filter(id => (counts.get(id) ?? 0) > 1);
  return { matchedIds, unknownIds, duplicateIds };
}
