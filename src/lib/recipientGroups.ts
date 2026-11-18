/**
 * Named recipient groups: a title plus a list of student national IDs.
 * Groups never store message bodies or credentials.
 */
import { newId } from './repo/mapping';
import type { Student } from '../types';

export interface RecipientGroup {
  id: string;
  title: string;
  studentNationalIds: string[];
  createdAt: string;
  updatedAt: string;
}

export const LOCAL_GROUPS_KEY = 'sn_recipient_groups';
export const GROUP_TITLE_MAX = 80;

export function normalizeNationalIds(ids: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function sanitizeGroupTitle(title: string): string {
  return String(title ?? '').trim().slice(0, GROUP_TITLE_MAX);
}

export function isValidGroup(v: unknown): v is RecipientGroup {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const g = v as Record<string, unknown>;
  return typeof g.id === 'string' && g.id.trim().length > 0
    && typeof g.title === 'string'
    && Array.isArray(g.studentNationalIds);
}

export function parseGroups(value: unknown): RecipientGroup[] {
  if (!Array.isArray(value)) return [];
  const out: RecipientGroup[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isValidGroup(item)) continue;
    const id = String(item.id).trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const createdAt = typeof item.createdAt === 'string' ? item.createdAt : '';
    const updatedAt = typeof item.updatedAt === 'string' ? item.updatedAt : createdAt;
    out.push({
      id,
      title: sanitizeGroupTitle(item.title) || 'مجموعة',
      studentNationalIds: normalizeNationalIds(item.studentNationalIds.map(String)),
      createdAt,
      updatedAt,
    });
  }
  return out;
}

export function buildRecipientGroup(title: string, ids: Iterable<string>, now = new Date(), existingId?: string): RecipientGroup {
  const stamp = now.toISOString();
  return {
    id: existingId || newId(),
    title: sanitizeGroupTitle(title) || 'مجموعة',
    studentNationalIds: normalizeNationalIds(ids),
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export interface ResolveGroupResult {
  matchedIds: string[];
  skippedIds: string[];
  skippedCount: number;
}

/** Keep only IDs that still exist in the student list; report stale IDs. */
export function resolveGroupMembers(group: RecipientGroup, students: Student[]): ResolveGroupResult {
  const known = new Set(students.map(s => String(s.id).trim()).filter(Boolean));
  const matchedIds: string[] = [];
  const skippedIds: string[] = [];
  for (const id of normalizeNationalIds(group.studentNationalIds)) {
    if (known.has(id)) matchedIds.push(id);
    else skippedIds.push(id);
  }
  return { matchedIds, skippedIds, skippedCount: skippedIds.length };
}

export function readLocalGroups(): RecipientGroup[] {
  try {
    const raw = localStorage.getItem(LOCAL_GROUPS_KEY);
    if (!raw) return [];
    return parseGroups(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeLocalGroups(groups: RecipientGroup[]): void {
  try {
    localStorage.setItem(LOCAL_GROUPS_KEY, JSON.stringify(parseGroups(groups)));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

export function upsertLocalGroup(group: RecipientGroup): RecipientGroup[] {
  const all = readLocalGroups();
  const i = all.findIndex(g => g.id === group.id);
  if (i >= 0) all[i] = group;
  else all.push(group);
  writeLocalGroups(all);
  return all;
}

export function deleteLocalGroup(id: string): RecipientGroup[] {
  const all = readLocalGroups().filter(g => g.id !== id);
  writeLocalGroups(all);
  return all;
}

/** PostgREST / Postgres signals that the recipient_groups table is not applied yet. */
export function isMissingRelationError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; details?: string; hint?: string; cause?: { code?: string; message?: string } };
  const code = String(e?.code ?? e?.cause?.code ?? '');
  const msg = `${e?.message ?? ''} ${e?.details ?? ''} ${e?.hint ?? ''} ${e?.cause?.message ?? ''}`.toLowerCase();
  return code === 'PGRST205' || code === 'PGRST106' || code === '42P01'
    || /could not find the table|does not exist|schema cache|relation .* does not exist/.test(msg);
}
