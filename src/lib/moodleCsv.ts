/**
 * Parsers for Moodle CSV/Excel exports (participants / last-access, grading
 * worksheets, and quiz reports). All matching of rows to school students is
 * done separately (moodleMatch.ts). Grades and passwords are never written
 * to student records by these parsers.
 *
 * Fixtures and comments use fake names and IDs only.
 */
import * as XLSX from 'xlsx';
import { toAsciiDigits } from './phone';

export type MoodleExportKind = 'participants' | 'grading' | 'quiz' | 'unknown';

export type AssignmentStatus = 'submitted' | 'draft' | 'no_submission' | 'other';
export type QuizState = 'finished' | 'in_progress' | 'not_attempted' | 'other';

export interface MoodleRow {
  /** Original cells, keyed by the file's raw header text. */
  raw: Record<string, string>;
  nationalId?: string;
  moodleUserId?: string;
  username?: string;
  fullName?: string;
  section?: string;
  lastAccessRaw?: string;
  /** Parsed last-access instant; undefined = missing/unparsed; null = never. */
  lastAccessAt?: Date | null;
  neverAccessed: boolean;
  assignmentStatus?: AssignmentStatus;
  quizState?: QuizState;
  closeAt?: Date | null;
  closeAtRaw?: string;
  /** Grade text kept only in the import session — never persisted. */
  gradeText?: string;
}

export interface ParsedMoodleFile {
  kind: MoodleExportKind;
  headers: string[];
  rows: MoodleRow[];
  /** Why the kind was chosen (for the review UI). */
  kindReason: string;
}

function clean(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).replace(/^\uFEFF/, '').trim();
}

export function normalizeHeader(h: string): string {
  return clean(h)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[_./\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NATIONAL_ID_HEADERS = new Set([
  'id number', 'idnumber', 'national id', 'nationalid', 'identity',
  'رقم الهويه', 'رقم هويه', 'رقم بطاقه التعريف', 'رقم بطاقه', 'رقم الهويه الوطنيه',
  'username', 'اسم المستخدم', // many school exports put the national ID in "username"
]);

const USERNAME_ONLY_HEADERS = new Set([
  'username', 'user name', 'اسم المستخدم', 'اسم مستخدم',
]);

const MOODLE_USER_ID_HEADERS = new Set([
  'userid', 'user id', 'moodle id', 'moodle userid', 'رقم المستخدم',
  'identifier', // grading worksheet "Identifier" is often a Moodle id or "ParticipantN"
]);

const FIRST_NAME_HEADERS = new Set([
  'first name', 'firstname', 'الاسم الاول', 'الاسم الأول',
]);
const LAST_NAME_HEADERS = new Set([
  'surname', 'last name', 'lastname', 'اللقب', 'اسم العائله', 'اسم العائلة', 'الاسم الاخير', 'الاسم الأخير',
]);
const FULL_NAME_HEADERS = new Set([
  'full name', 'fullname', 'name', 'اسم الطالب', 'الاسم', 'الاسم الكامل',
]);
const SECTION_HEADERS = new Set([
  'groups', 'group', 'section', 'class', 'الشعبه', 'الشعبة', 'المجموعه', 'المجموعة', 'الصف', 'الصف والشعبه', 'الصف والشعبة',
]);
const LAST_ACCESS_HEADERS = new Set([
  'last access to course', 'last access', 'last downloaded from this course',
  'اخر دخول للمساق', 'آخر دخول للمساق', 'اخر دخول', 'آخر دخول', 'تاريخ اخر دخول', 'تاريخ آخر دخول',
]);
const ASSIGNMENT_STATUS_HEADERS = new Set([
  'status', 'الحاله', 'الحالة', 'حاله التسليم', 'حالة التسليم',
]);
const QUIZ_STATE_HEADERS = new Set([
  'state', 'الحاله', 'الحالة', 'حاله المحاوله', 'حالة المحاولة',
]);
const CLOSE_HEADERS = new Set([
  'close time', 'closes', 'quiz close', 'deadline', 'موعد الاغلاق', 'موعد الإغلاق', 'تاريخ الاغلاق', 'تاريخ الإغلاق',
]);
const GRADE_HEADERS = new Set([
  'grade', 'grade/100', 'العلامه', 'العلامة', 'الدرجه', 'الدرجة',
]);

function firstHeader(headers: string[], set: Set<string>): string | undefined {
  return headers.find(h => set.has(normalizeHeader(h)));
}

/** Heuristic: Moodle usernames that are 4–15 digits are treated as a national ID. */
export function asNationalId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = toAsciiDigits(value).replace(/[^\d]/g, '');
  if (digits.length >= 4 && digits.length <= 15) return digits;
  return undefined;
}

export function detectMoodleKind(headers: string[]): { kind: MoodleExportKind; reason: string } {
  const n = headers.map(normalizeHeader);
  const has = (...needles: string[]) => needles.some(x => n.includes(x));
  if (has('last access to course', 'last access', 'اخر دخول للمساق', 'آخر دخول للمساق', 'اخر دخول', 'آخر دخول')) {
    return { kind: 'participants', reason: 'عمود آخر دخول' };
  }
  if (has('status', 'حاله التسليم', 'حالة التسليم') && !has('state', 'حاله المحاوله', 'حالة المحاولة')) {
    return { kind: 'grading', reason: 'ورقة تقييم (عمود الحالة)' };
  }
  if (has('state', 'حاله المحاوله', 'حالة المحاولة', 'started on', 'time taken', 'وقت المستغرق', 'بدأت في')) {
    return { kind: 'quiz', reason: 'تقرير اختبار' };
  }
  if (has('status', 'الحاله', 'الحالة') && has('identifier', 'grade', 'العلامه', 'العلامة')) {
    return { kind: 'grading', reason: 'ورقة تقييم' };
  }
  return { kind: 'unknown', reason: 'لم يُتعرّف على نوع ملف مودل تلقائياً' };
}

const NEVER_RE = /^(never|n\/?a|-|—|–|none|null|أبداً?|ابداً?|لم\s*يدخل|لا\s*يوجد)$/i;

export function parseLastAccess(raw: string, now: Date = new Date()): { at: Date | null | undefined; never: boolean } {
  const text = clean(raw);
  if (!text || NEVER_RE.test(text)) return { at: null, never: true };
  // Relative Moodle strings, e.g. "5 days 2 hours", "2 days", "الآن"
  if (/^(now|الآن|الان)$/i.test(text)) return { at: new Date(now.getTime()), never: false };
  const rel = text.match(/(\d+)\s*(day|days|يوم|ايام|أيام|d)\b/i);
  if (rel) {
    const days = Number(rel[1]);
    const at = new Date(now.getTime() - days * 86400000);
    return { at, never: false };
  }
  const hours = text.match(/(\d+)\s*(hour|hours|ساعه|ساعة|ساعات|h)\b/i);
  if (hours && !rel) {
    const at = new Date(now.getTime() - Number(hours[1]) * 3600000);
    return { at, never: false };
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return { at: new Date(parsed), never: false };
  // dd/mm/yyyy or yyyy-mm-dd already handled by Date.parse in many engines; try d/m/y explicitly
  const mdy = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (mdy) {
    const d = Number(mdy[1]);
    const mo = Number(mdy[2]);
    let y = Number(mdy[3]);
    if (y < 100) y += 2000;
    // Prefer d/m/y (common in the region) when the first number is > 12 or when both are valid.
    const candidate = new Date(y, mo - 1, d);
    if (candidate.getFullYear() === y && candidate.getMonth() === mo - 1 && candidate.getDate() === d) {
      return { at: candidate, never: false };
    }
    const alt = new Date(y, d - 1, mo);
    if (alt.getFullYear() === y && alt.getMonth() === d - 1 && alt.getDate() === mo) {
      return { at: alt, never: false };
    }
  }
  return { at: undefined, never: false };
}

export function classifyAssignmentStatus(raw: string): AssignmentStatus {
  const t = normalizeHeader(raw);
  if (!t) return 'other';
  // Draft first: "Draft (not submitted)" / "مسودة (لم يتم التسليم)" must not be classified as submitted.
  if (/(draft|مسوده)/.test(t)) return 'draft';
  if (/(no submission|لم\s*يسل[مّ]|لا يوجد تسليم|بدون تسليم|not submitted)/.test(t)) return 'no_submission';
  if (/(submitted|تم التسليم|مسل[مّ]|graded|تم التصحيح)/.test(t)) return 'submitted';
  return 'other';
}

export function classifyQuizState(raw: string): QuizState {
  const t = normalizeHeader(raw);
  if (!t) return 'not_attempted';
  if (/(not attempted|not yet started|لم\s*يحاول|لم\s*يبدأ|بدون محاوله|بدون محاولة)/.test(t)) return 'not_attempted';
  if (/(in progress|قيد التنفيذ|جاريه|جارية|لم تكتمل)/.test(t)) return 'in_progress';
  if (/(finished|completed|انتهت|مكتمل|تمت)/.test(t)) return 'finished';
  return 'other';
}

function cell(row: Record<string, string>, header: string | undefined): string {
  if (!header) return '';
  return clean(row[header]);
}

export function mapMoodleRows(
  headers: string[],
  records: Record<string, string>[],
  kind: MoodleExportKind,
  now: Date = new Date(),
): MoodleRow[] {
  const nidH = firstHeader(headers, NATIONAL_ID_HEADERS);
  const userH = firstHeader(headers, USERNAME_ONLY_HEADERS);
  const midH = firstHeader(headers, MOODLE_USER_ID_HEADERS);
  const firstH = firstHeader(headers, FIRST_NAME_HEADERS);
  const lastH = firstHeader(headers, LAST_NAME_HEADERS);
  const fullH = firstHeader(headers, FULL_NAME_HEADERS);
  const sectionH = firstHeader(headers, SECTION_HEADERS);
  const accessH = firstHeader(headers, LAST_ACCESS_HEADERS);
  const statusH = firstHeader(headers, ASSIGNMENT_STATUS_HEADERS);
  const stateH = firstHeader(headers, QUIZ_STATE_HEADERS);
  const closeH = firstHeader(headers, CLOSE_HEADERS);
  const gradeH = firstHeader(headers, GRADE_HEADERS);

  const SECRET_HEADER = /password|كلمه المرور|كلمة المرور|ملاحظات|notes/i;
  return records.map(rawIn => {
    const raw: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawIn)) {
      if (SECRET_HEADER.test(k) || SECRET_HEADER.test(normalizeHeader(k))) continue;
      raw[k] = v;
    }
    const username = cell(raw, userH);
    const idNumber = cell(raw, nidH);
    // If the chosen "national id" header is also the username header, treat digit-only values as IDs.
    const nationalId = asNationalId(idNumber) ?? (nidH === userH ? asNationalId(username) : undefined);
    const first = cell(raw, firstH);
    const last = cell(raw, lastH);
    const full = cell(raw, fullH) || [first, last].filter(Boolean).join(' ').trim();
    const accessRaw = cell(raw, accessH);
    const access = accessH ? parseLastAccess(accessRaw, now) : { at: undefined, never: false };
    const statusRaw = cell(raw, statusH);
    const stateRaw = cell(raw, kind === 'quiz' ? stateH : undefined);
    const closeRaw = cell(raw, closeH);
    const close = closeRaw ? parseLastAccess(closeRaw, now) : { at: undefined, never: false };
    const midRaw = cell(raw, midH);
    const moodleUserId = midRaw && !asNationalId(midRaw) ? midRaw : (midH && midH !== nidH && midH !== userH ? midRaw : '');

    const row: MoodleRow = {
      raw,
      nationalId,
      moodleUserId: clean(moodleUserId) || undefined,
      username: username || undefined,
      fullName: full || undefined,
      section: cell(raw, sectionH) || undefined,
      lastAccessRaw: accessRaw || undefined,
      lastAccessAt: accessH ? access.at : undefined,
      neverAccessed: Boolean(accessH) && access.never,
      gradeText: cell(raw, gradeH) || undefined,
    };
    if (kind === 'grading' || statusRaw) row.assignmentStatus = classifyAssignmentStatus(statusRaw);
    if (kind === 'quiz' || stateRaw) row.quizState = classifyQuizState(stateRaw);
    if (closeRaw) {
      row.closeAtRaw = closeRaw;
      row.closeAt = close.at ?? null;
    }
    return row;
  }).filter(r => r.nationalId || r.moodleUserId || r.username || r.fullName);
}

export function parseTableText(text: string): { headers: string[]; records: Record<string, string>[] } {
  const wb = XLSX.read(text.replace(/^\uFEFF/, ''), { type: 'string' });
  return sheetToRecords(wb);
}

export function parseSpreadsheetBuffer(data: ArrayBuffer | Uint8Array, filename = ''): { headers: string[]; records: Record<string, string>[] } {
  const wb = XLSX.read(data, { type: 'array' });
  return sheetToRecords(wb, filename);
}

function sheetToRecords(wb: XLSX.WorkBook, _filename = ''): { headers: string[]; records: Record<string, string>[] } {
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], records: [] };
  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: false, defval: '' }) as unknown as Array<Array<string | number | null>>;
  if (!aoa.length) return { headers: [], records: [] };
  const headers = (aoa[0] ?? []).map(c => clean(c));
  // Drop trailing empty headers
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  const records: Record<string, string>[] = [];
  for (const line of aoa.slice(1)) {
    if (!line || line.every(c => !clean(c))) continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { rec[h] = clean(line[i]); });
    records.push(rec);
  }
  return { headers, records };
}

export function parseMoodleFile(
  input: { text?: string; buffer?: ArrayBuffer | Uint8Array; filename?: string },
  opts: { kind?: MoodleExportKind; now?: Date } = {},
): ParsedMoodleFile {
  const table = input.buffer
    ? parseSpreadsheetBuffer(input.buffer, input.filename)
    : parseTableText(input.text || '');
  const detected = detectMoodleKind(table.headers);
  const kind = opts.kind && opts.kind !== 'unknown' ? opts.kind : detected.kind;
  return {
    kind,
    headers: table.headers,
    rows: mapMoodleRows(table.headers, table.records, kind, opts.now ?? new Date()),
    kindReason: opts.kind && opts.kind !== 'unknown' ? 'اختاره المعلم' : detected.reason,
  };
}

export function daysSinceAccess(row: MoodleRow, now: Date = new Date()): number | null {
  if (row.neverAccessed) return Infinity;
  if (!row.lastAccessAt) return null;
  return Math.max(0, (now.getTime() - row.lastAccessAt.getTime()) / 86400000);
}

export function isNeverLoggedIn(row: MoodleRow): boolean {
  return row.neverAccessed === true;
}

export function isNotSince(row: MoodleRow, days: number, now: Date = new Date()): boolean {
  if (row.neverAccessed) return true;
  const d = daysSinceAccess(row, now);
  return d !== null && d >= days;
}

export function isNotSubmitted(row: MoodleRow): boolean {
  return row.assignmentStatus === 'no_submission';
}

export function isDraft(row: MoodleRow): boolean {
  return row.assignmentStatus === 'draft';
}

export function isNotAttempted(row: MoodleRow): boolean {
  return row.quizState === 'not_attempted';
}
