/**
 * Single-student edit: validation and pure apply helpers (unit-tested).
 * Only name, grade, section, phone (رقم 1) and phone2 (رقم 2) are editable. Notes are never touched.
 */
import type { Student } from '../types';
import { checkPhone, PHONE_PROBLEM_LABELS } from './phone';

export interface StudentEditForm {
  name: string;
  grade: string;
  section: string;
  phone: string;
  phone2: string;
}

/** The only fields a single-student edit may change. */
export type StudentEditPatch = Pick<Student, 'name' | 'grade' | 'section' | 'phone' | 'phone2'>;

export type StudentEditErrors = Partial<Record<keyof StudentEditForm | 'form', string>>;

export function studentToEditForm(s: Student): StudentEditForm {
  return {
    name: s.name ?? '',
    grade: s.grade ?? '',
    section: s.section ?? '',
    phone: s.phone ?? '',
    phone2: s.phone2 ?? '',
  };
}

/**
 * Validates the form. Each non-empty phone must be a valid mobile number (normalised to 05XXXXXXXX);
 * either phone may be empty, but at least one valid phone is required. Name is required.
 */
export function validateStudentEdit(form: StudentEditForm): { ok: true; patch: StudentEditPatch } | { ok: false; errors: StudentEditErrors } {
  const errors: StudentEditErrors = {};
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'الاسم مطلوب';

  const norm = (raw: string, key: 'phone' | 'phone2'): string => {
    if (!raw.trim()) return '';
    const c = checkPhone(raw);
    if (!c.valid) {
      errors[key] = `${PHONE_PROBLEM_LABELS[c.problem ?? 'invalid']} — المطلوب رقم جوال مثل 05XXXXXXXX`;
      return '';
    }
    return c.local;
  };
  const phone = norm(form.phone, 'phone');
  const phone2 = norm(form.phone2, 'phone2');
  if (!errors.phone && !errors.phone2 && !phone && !phone2) errors.form = 'يجب إدخال رقم جوال صالح واحد على الأقل';

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, patch: { name, grade: form.grade.trim(), section: form.section.trim(), phone, phone2 } };
}

/** Returns a new list where ONLY the student with `id` has the patch applied; order and count are unchanged. */
export function applyStudentEdit(students: Student[], id: string, patch: StudentEditPatch): Student[] {
  return students.map(s => (s.id === id ? { ...s, ...patch } : s));
}
