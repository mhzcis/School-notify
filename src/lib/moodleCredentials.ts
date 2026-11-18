/**
 * Dedicated Moodle-credentials import and helpers.
 * Credentials must never be written to students.notes / students.extra, never
 * appear in backups, reports, or logs, and are imported only through this path.
 */
import * as XLSX from 'xlsx';
import { asNationalId, normalizeHeader } from './moodleCsv';
import { toAsciiDigits } from './phone';

export interface MoodleCredential {
  nationalId: string;
  moodleUsername: string;
  moodlePassword: string;
}

export interface CredentialsParseResult {
  rows: MoodleCredential[];
  /** National IDs that appeared more than once; last row wins. */
  duplicateIds: string[];
  /** Data rows skipped because they had no valid national ID. */
  skippedNoId: number;
  headers: string[];
}

const ID_HEADERS = new Set([
  'id number', 'idnumber', 'national id', 'nationalid', 'رقم الهويه', 'رقم هويه',
  'رقم بطاقه التعريف', 'رقم بطاقه', 'الهويه', 'username', 'اسم المستخدم', // digit-only username
]);
const USER_HEADERS = new Set([
  'moodle username', 'اسم مستخدم مودل', 'اسم المستخدم', 'username', 'user name',
]);
const PASS_HEADERS = new Set([
  'moodle password', 'كلمه مرور مودل', 'كلمة مرور مودل', 'كلمه المرور', 'كلمة المرور',
  'password', 'pass',
]);

function clean(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).replace(/^\uFEFF/, '').trim();
}

function first(headers: string[], set: Set<string>, except?: string): string | undefined {
  return headers.find(h => set.has(normalizeHeader(h)) && h !== except);
}

/**
 * Parse a dedicated credentials sheet. Matching is by national ID only —
 * a name column is ignored and never used to attach a password.
 */
export function parseCredentialsTable(headers: string[], records: Record<string, string>[]): CredentialsParseResult {
  const idH = first(headers, ID_HEADERS);
  const userH = first(headers, USER_HEADERS);
  const passH = first(headers, PASS_HEADERS);
  const seen = new Map<string, MoodleCredential>();
  const dup = new Set<string>();
  let skippedNoId = 0;

  for (const rec of records) {
    const id = asNationalId(idH ? rec[idH] : '') || asNationalId(userH ? rec[userH] : '');
    if (!id) {
      if (Object.values(rec).some(v => clean(v))) skippedNoId += 1;
      continue;
    }
    const username = clean(userH ? rec[userH] : '');
    // If the username column was also used as the ID, don't store the ID digits as the username
    // unless a different username header exists.
    const usernameIsIdColumn = userH === idH || asNationalId(username) === id;
    const cred: MoodleCredential = {
      nationalId: id,
      moodleUsername: usernameIsIdColumn && first(headers, USER_HEADERS, idH) == null
        ? id
        : (usernameIsIdColumn ? id : username) || id,
      moodlePassword: clean(passH ? rec[passH] : ''),
    };
    // Prefer a dedicated username when present and not just the ID.
    const dedicatedUser = first(headers, new Set([...USER_HEADERS].filter(x => !ID_HEADERS.has(x) || x.includes('مودل') || x.includes('moodle'))));
    if (dedicatedUser && clean(rec[dedicatedUser])) cred.moodleUsername = clean(rec[dedicatedUser]);
    if (seen.has(id)) dup.add(id);
    seen.set(id, cred);
  }

  return {
    rows: [...seen.values()],
    duplicateIds: [...dup],
    skippedNoId,
    headers,
  };
}

export function parseCredentialsFile(input: { text?: string; buffer?: ArrayBuffer | Uint8Array }): CredentialsParseResult {
  const data = input.buffer
    ? XLSX.read(input.buffer, { type: 'array' })
    : XLSX.read((input.text || '').replace(/^\uFEFF/, ''), { type: 'string' });
  const sheet = data.Sheets[data.SheetNames[0] ?? ''];
  if (!sheet) return { rows: [], duplicateIds: [], skippedNoId: 0, headers: [] };
  const aoa = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, { header: 1, raw: false, defval: '' });
  const headers = ((aoa[0] ?? []) as Array<string | number | null>).map(c => clean(c));
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  const records: Record<string, string>[] = [];
  for (const line of aoa.slice(1) as Array<Array<string | number | null>>) {
    if (!line || line.every(c => !clean(c))) continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { rec[h] = clean(line[i]); });
    records.push(rec);
  }
  return parseCredentialsTable(headers, records);
}

/** Mask a password for any UI list. Never logs the real value. */
export function maskCredentialPassword(password: string): string {
  const v = String(password ?? '');
  if (!v) return '';
  return '••••••';
}

export function credentialsByNationalId(list: MoodleCredential[]): Map<string, MoodleCredential> {
  const map = new Map<string, MoodleCredential>();
  for (const c of list) {
    const id = toAsciiDigits(c.nationalId).trim();
    if (id) map.set(id, c);
  }
  return map;
}

export function attachCredentials<T extends { id: string; idNumber?: string; moodleUsername?: string; moodlePassword?: string }>(
  student: T,
  creds: Map<string, MoodleCredential>,
): T {
  const keys = [student.id, student.idNumber].map(v => toAsciiDigits(String(v ?? '')).trim()).filter(Boolean);
  for (const k of keys) {
    const c = creds.get(k);
    if (c) return { ...student, moodleUsername: c.moodleUsername, moodlePassword: c.moodlePassword };
  }
  return student;
}
