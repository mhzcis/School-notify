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
  { tag: '{{الاسم_الأول}}', label: 'الاسم الأول للطالب' },
  { tag: '{{اسم_ولي_الأمر}}', label: 'اسم ولي الأمر' },
  { tag: '{{الصف}}', label: 'الصف الدراسي' },
  { tag: '{{الشعبة}}', label: 'الشعبة' },
  { tag: '{{ملاحظات}}', label: 'الملاحظات/المستحقات' },
  { tag: '{{اليوم}}', label: 'تاريخ اليوم' },
  { tag: '{{اسم_المستخدم}}', label: 'اسم مستخدم مودل' },
  { tag: '{{كلمة_المرور}}', label: 'كلمة مرور مودل (حساسة)', sensitive: true },
];

/** Placeholder keys whose values are secrets (masked in previews, lists and stored logs). */
export const SECRET_KEYS = ['كلمة_المرور'];
export const SECRET_MASK = '••••••';

/** True when the template references a secret placeholder such as {{كلمة_المرور}}. */
export function templateUsesSecrets(template: string): boolean {
  return /{{\s*كلمة_المرور\s*}}/.test(template || '');
}

/** Moodle placeholders used by the template that the student has no value for. */
export function missingMoodleFields(template: string, student: Partial<Student>): Array<'moodleUsername' | 'moodlePassword'> {
  const out: Array<'moodleUsername' | 'moodlePassword'> = [];
  if (/{{\s*اسم_المستخدم\s*}}/.test(template || '') && !clean(student.moodleUsername)) out.push('moodleUsername');
  if (templateUsesSecrets(template) && !clean(student.moodlePassword)) out.push('moodlePassword');
  return out;
}

export const DEFAULT_NOTES_TEXT = 'لا يوجد مستحقات متأخرة';

export interface RenderOptions {
  /** Date used for {{اليوم}} (defaults to now). */
  today?: Date;
  /** Replace secret values (e.g. the Moodle password) with a mask. Use for anything displayed in lists or stored. */
  maskSecrets?: boolean;
}

export function formatArabicDate(d: Date): string {
  return d.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function firstName(fullName: string | undefined | null): string {
  if (!fullName) return '';
  return fullName.trim().split(/\s+/)[0] ?? '';
}

function clean(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim();
}

/** Renders a template for one student. {{اسم_الطالب}} is the FULL name. */
export function renderTemplate(template: string, student: Partial<Student>, options: RenderOptions = {}): string {
  const values: Record<string, string> = {
    'اسم_الطالب': clean(student.name).replace(/\s+/g, ' '),
    'الاسم_الأول': firstName(student.name),
    'اسم_ولي_الأمر': clean(student.parentName),
    'الصف': clean(student.grade),
    'الشعبة': clean(student.section),
    'ملاحظات': clean(student.notes) || DEFAULT_NOTES_TEXT,
    'اليوم': formatArabicDate(options.today ?? new Date()),
    'اسم_المستخدم': clean(student.moodleUsername),
    'كلمة_المرور': options.maskSecrets && clean(student.moodlePassword) ? SECRET_MASK : clean(student.moodlePassword),
  };
  return template.replace(/{{\s*([^{}]+?)\s*}}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  );
}
