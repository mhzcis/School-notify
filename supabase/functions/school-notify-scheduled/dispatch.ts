/**
 * Pure helpers for the scheduled sender (Deno). Keep in sync with
 * src/lib/scheduledSend.ts, src/lib/phone.ts, src/lib/template.ts, src/lib/recipients.ts.
 * Never logs phones, bodies, or credentials.
 */
export const QUIET_HOURS_START = 22;
export const QUIET_HOURS_END = 7;
export const SCHEDULER_TIME_ZONE = 'Asia/Jerusalem';
export const DEFAULT_MAX_PER_RUN = 50;

export function hourInTimeZone(at: Date, timeZone: string = SCHEDULER_TIME_ZONE): number {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(at));
  return Number.isFinite(hour) ? hour : at.getHours();
}

export function isQuietHours(at: Date = new Date(), timeZone: string = SCHEDULER_TIME_ZONE): boolean {
  const hour = hourInTimeZone(at, timeZone);
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

export function templateUsesSecrets(template: string): boolean {
  return /{{\s*(?:كلمة_المرور|كلمة_مرور_مودل)\s*}}/.test(template || '');
}

export function templateUsesCredentials(template: string): boolean {
  return templateUsesSecrets(template) || /{{\s*اسم_المستخدم\s*}}|{{\s*اسم_مستخدم_مودل\s*}}/.test(template || '');
}

const COMPOUND_FIRST_PREFIXES = new Set(['عبد', 'عبدال', 'ابو', 'ابا', 'ابي']);
function normalizeAlef(token: string): string {
  return token.replace(/[أإآٱ]/g, 'ا');
}
function firstName(fullName: string): string {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length >= 2 && COMPOUND_FIRST_PREFIXES.has(normalizeAlef(parts[0]))) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}
function clean(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim();
}

export interface RenderStudent {
  name?: string;
  parentName?: string;
  grade?: string;
  section?: string;
  moodleUsername?: string;
  moodlePassword?: string;
}

export function renderTemplate(template: string, student: RenderStudent, opts: { maskSecrets?: boolean; quizUrl?: string; closeDate?: string; today?: Date } = {}): string {
  const fullName = clean(student.name).replace(/\s+/g, ' ');
  const pass = opts.maskSecrets && clean(student.moodlePassword) ? '••••••' : clean(student.moodlePassword);
  const today = (opts.today ?? new Date()).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const values: Record<string, string> = {
    'اسم_الطالب': fullName,
    'الاسم_الكامل': fullName,
    'الاسم_الأول': firstName(student.name || ''),
    'اسم_ولي_الأمر': clean(student.parentName),
    'الصف': clean(student.grade),
    'الشعبة': clean(student.section),
    'اليوم': today,
    'اسم_المستخدم': clean(student.moodleUsername),
    'اسم_مستخدم_مودل': clean(student.moodleUsername),
    'كلمة_المرور': pass,
    'كلمة_مرور_مودل': pass,
    'رابط_الاختبار': clean(opts.quizUrl),
    'موعد_الإغلاق': clean(opts.closeDate),
  };
  return template.replace(/{{\s*([^{}]+?)\s*}}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  );
}

export function toAsciiDigits(s: string): string {
  return String(s ?? '').replace(/[\u0660-\u0669]/g, ch => String(ch.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, ch => String(ch.charCodeAt(0) - 0x06F0));
}

export function toE164(raw: unknown): { local: string; e164: string } | null {
  let digits = toAsciiDigits(String(raw ?? '')).replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0')) {
    // national 0XXXXXXXXX
  }
  let national = digits;
  if (national.startsWith('970') || national.startsWith('972')) national = national.slice(3);
  if (national.startsWith('0')) national = national.slice(1);
  if (!/^5\d{8}$/.test(national) && !/^\d{8,12}$/.test(national)) {
    // still try if already international other country
    const intl = digits.startsWith('970') || digits.startsWith('972') ? digits : (digits.length >= 8 ? '970' + national : '');
    if (!/^[1-9]\d{7,14}$/.test(intl)) return null;
    const local = intl.startsWith('970') || intl.startsWith('972') ? '0' + intl.slice(3) : intl;
    return { local, e164: '+' + intl };
  }
  return { local: '0' + national, e164: '+970' + national };
}

export interface DispatchItem {
  studentId: string;
  studentUuid: string | null;
  studentName: string;
  parentName: string;
  phoneLocal: string;
  phoneE164: string;
  grade: string;
  section: string;
  content: string;
  logContent: string;
}

export interface StudentRec {
  uuid: string;
  nationalId: string;
  name: string;
  parentName: string;
  phone: string;
  phone2?: string;
  grade: string;
  section: string;
  moodleUsername?: string;
  moodlePassword?: string;
}

export function resolveTargets(campaign: { targetType?: string; targetGrade?: string; targetSection?: string; targetStudentIds?: string[] }, students: StudentRec[]): StudentRec[] {
  const type = campaign.targetType ?? 'all';
  if (type === 'grade') return students.filter(s => s.grade === campaign.targetGrade);
  if (type === 'section') return students.filter(s => s.grade === campaign.targetGrade && s.section === campaign.targetSection);
  if (type === 'custom' && campaign.targetStudentIds?.length) {
    const set = new Set(campaign.targetStudentIds);
    return students.filter(s => set.has(s.nationalId));
  }
  if (type === 'all') return [...students];
  return [];
}

export function buildItems(
  students: StudentRec[],
  phoneTarget: 'primary' | 'secondary' | 'both',
  template: string,
): DispatchItem[] {
  const items: DispatchItem[] = [];
  for (const s of students) {
    const wanted: Array<'primary' | 'secondary'> = phoneTarget === 'both' ? ['primary', 'secondary'] : [phoneTarget];
    const seen = new Set<string>();
    let content: string | null = null;
    let logContent: string | null = null;
    for (const which of wanted) {
      const raw = which === 'primary' ? s.phone : s.phone2;
      if (which === 'secondary' && phoneTarget === 'both' && !String(raw ?? '').trim()) continue;
      const parsed = toE164(raw);
      if (!parsed) continue;
      if (seen.has(parsed.local)) continue;
      seen.add(parsed.local);
      if (content === null) {
        content = renderTemplate(template, s);
        logContent = templateUsesSecrets(template) ? renderTemplate(template, s, { maskSecrets: true }) : content;
      }
      items.push({
        studentId: s.nationalId,
        studentUuid: s.uuid || null,
        studentName: s.name,
        parentName: s.parentName,
        phoneLocal: parsed.local,
        phoneE164: parsed.e164,
        grade: s.grade,
        section: s.section,
        content,
        logContent: logContent as string,
      });
    }
  }
  return items;
}

export function alreadySentKeys(rows: Array<{ studentId: string; phone: string; status: string }>): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.status === 'failed') continue;
    const p = toE164(r.phone)?.local ?? String(r.phone || '').trim();
    keys.add(`${r.studentId}|${p}`);
  }
  return keys;
}

export function remainingItems(items: DispatchItem[], sent: Set<string>): DispatchItem[] {
  return items.filter(i => !sent.has(`${i.studentId}|${i.phoneLocal}`));
}
