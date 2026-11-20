/**
 * Single shared template renderer for all message placeholders.
 * Used by the composer, the scheduler and every preview so the output is identical everywhere.
 */
import type { Student } from '../types';

export interface PlaceholderDef {
  tag: string;
  label: string;
  sensitive?: boolean;
}

/** Placeholders shown in the template pickers (order = display order). */
export const PLACEHOLDERS: PlaceholderDef[] = [
  { tag: '{{اسم_الطالب}}', label: 'اسم الطالب الكامل' },
  { tag: '{{الاسم_الكامل}}', label: 'الاسم الكامل (مرادف لاسم الطالب)' },
  { tag: '{{الاسم_الأول}}', label: 'الاسم الأول للطالب (مع الأسماء المركبة)' },
  { tag: '{{اسم_ولي_الأمر}}', label: 'اسم ولي الأمر' },
  { tag: '{{الصف}}', label: 'الصف الدراسي' },
  { tag: '{{الشعبة}}', label: 'الشعبة' },
  { tag: '{{اليوم}}', label: 'تاريخ اليوم' },
  { tag: '{{اسم_المستخدم}}', label: 'اسم مستخدم مودل' },
  { tag: '{{اسم_مستخدم_مودل}}', label: 'اسم مستخدم مودل (مرادف)' },
  { tag: '{{كلمة_المرور}}', label: 'كلمة مرور مودل (حساسة)', sensitive: true },
  { tag: '{{كلمة_مرور_مودل}}', label: 'كلمة مرور مودل (حساسة، مرادف)', sensitive: true },
  { tag: '{{كلمة_المرور_الافتراضية}}', label: 'كلمة مرور مودل الافتراضية بعد إعادة التعيين (حساسة)', sensitive: true },
  { tag: '{{رابط_الاختبار}}', label: 'رابط فتح الاختبار للشعبة' },
  { tag: '{{موعد_الإغلاق}}', label: 'موعد إغلاق الاختبار أو الواجب' },
];

/** Placeholder keys whose values are secrets (masked in previews, lists and stored logs). */
export const SECRET_KEYS = ['كلمة_المرور', 'كلمة_مرور_مودل', 'كلمة_المرور_الافتراضية'];
export const SECRET_MASK = '••••••';

const SECRET_PLACEHOLDER_RE = /{{\s*(?:كلمة_المرور|كلمة_مرور_مودل|كلمة_المرور_الافتراضية)\s*}}/;
const PASSWORD_PLACEHOLDER_RE = /{{\s*(?:كلمة_المرور|كلمة_مرور_مودل)\s*}}/;
const DEFAULT_PASSWORD_PLACEHOLDER_RE = /{{\s*كلمة_المرور_الافتراضية\s*}}/;
const USERNAME_PLACEHOLDER_RE = /{{\s*اسم_المستخدم\s*}}|{{\s*اسم_مستخدم_مودل\s*}}/;

/** True when the template references a secret placeholder such as {{كلمة_المرور}} or {{كلمة_مرور_مودل}}. */
export function templateUsesSecrets(template: string): boolean {
  return SECRET_PLACEHOLDER_RE.test(template || '');
}

/** True when the template references a stored Moodle username or password placeholder. */
export function templateUsesCredentials(template: string): boolean {
  return templateUsesSecrets(template) || USERNAME_PLACEHOLDER_RE.test(template || '');
}

/** Moodle placeholders used by the template that the student has no value for. */
export function missingMoodleFields(
  template: string,
  student: Partial<Student>,
): Array<'moodleUsername' | 'moodlePassword' | 'moodleDefaultPassword'> {
  const out: Array<'moodleUsername' | 'moodlePassword' | 'moodleDefaultPassword'> = [];
  if (USERNAME_PLACEHOLDER_RE.test(template || '') && !clean(student.moodleUsername)) out.push('moodleUsername');
  if (PASSWORD_PLACEHOLDER_RE.test(template || '') && !clean(student.moodlePassword)) out.push('moodlePassword');
  if (DEFAULT_PASSWORD_PLACEHOLDER_RE.test(template || '') && !clean(student.moodleDefaultPassword)) out.push('moodleDefaultPassword');
  return out;
}

/** @deprecated Notes are no longer stored or offered as a placeholder; kept so old tests/imports can mention the previous default. */
export const DEFAULT_NOTES_TEXT = 'لا يوجد مستحقات متأخرة';

export interface RenderOptions {
  /** Date used for {{اليوم}} (defaults to now). */
  today?: Date;
  /** Replace secret values (e.g. the Moodle password) with a mask. Use for anything displayed in lists or stored. */
  maskSecrets?: boolean;
  /** Per-section quiz/assignment window (never read from student.notes). */
  quizUrl?: string;
  closeDate?: string;
}

export function formatArabicDate(d: Date): string {
  return d.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/** Alef variants so أبو / ابو / أبا are recognised as the same prefix. */
function normalizeAlef(token: string): string {
  return token.replace(/[أإآٱ]/g, 'ا');
}

const COMPOUND_FIRST_PREFIXES = new Set(['عبد', 'عبدال', 'ابو', 'ابا', 'ابي']);

/**
 * First name for {{الاسم_الأول}}. Keeps عبد / أبو / ابو (and common alef variants)
 * together with the following token, e.g. «عبد الرحمن» not «عبد».
 * A lone prefix with no following token is returned as-is.
 */
export function firstName(fullName: string | undefined | null): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length >= 2 && COMPOUND_FIRST_PREFIXES.has(normalizeAlef(parts[0]))) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0];
}

function clean(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim();
}

/** Renders a template for one student. {{اسم_الطالب}} is the FULL name. */
export function renderTemplate(template: string, student: Partial<Student>, options: RenderOptions = {}): string {
  const fullName = clean(student.name).replace(/\s+/g, ' ');
  const values: Record<string, string> = {
    'اسم_الطالب': fullName,
    'الاسم_الكامل': fullName,
    'الاسم_الأول': firstName(student.name),
    'اسم_ولي_الأمر': clean(student.parentName),
    'الصف': clean(student.grade),
    'الشعبة': clean(student.section),
    // Legacy placeholder: still rendered if an old template uses it, but never filled
    // with a misleading default now that notes are not stored.
    'ملاحظات': clean(student.notes),
    'اليوم': formatArabicDate(options.today ?? new Date()),
    'اسم_المستخدم': clean(student.moodleUsername),
    'اسم_مستخدم_مودل': clean(student.moodleUsername),
    'كلمة_المرور': options.maskSecrets && clean(student.moodlePassword) ? SECRET_MASK : clean(student.moodlePassword),
    'كلمة_مرور_مودل': options.maskSecrets && clean(student.moodlePassword) ? SECRET_MASK : clean(student.moodlePassword),
    'كلمة_المرور_الافتراضية': options.maskSecrets && clean(student.moodleDefaultPassword) ? SECRET_MASK : clean(student.moodleDefaultPassword),
    'رابط_الاختبار': clean(options.quizUrl),
    'موعد_الإغلاق': clean(options.closeDate),
  };
  return template.replace(/{{\s*([^{}]+?)\s*}}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  );
}
