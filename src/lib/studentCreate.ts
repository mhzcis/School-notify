/**
 * Add-student: validation and apply helpers (unit-tested).
 * Fields: national ID (required, unique), name, grade, section, phone 1/2. No notes field.
 */
import type { Student } from '../types';
import { toAsciiDigits } from './phone';
import { StudentEditErrors, StudentEditForm, validateStudentEdit } from './studentEdit';

export interface StudentCreateForm extends StudentEditForm {
  nationalId: string;
}

export type StudentCreateErrors = Partial<Record<keyof StudentCreateForm | 'form', string>>;

export interface StudentCreatePatch {
  id: string;
  name: string;
  grade: string;
  section: string;
  phone: string;
  phone2: string;
}

/** Palestinian-style IDs are typically 9 digits; accept 5–15 digits after Arabic-Indic normalisation. */
export function normalizeNationalId(raw: string): string {
  return toAsciiDigits(raw || '').replace(/\D/g, '').trim();
}

export function validateNationalId(raw: string): { ok: true; id: string } | { ok: false; error: string } {
  const id = normalizeNationalId(raw);
  if (!id) return { ok: false, error: 'رقم الهوية مطلوب' };
  if (id.length < 5 || id.length > 15) return { ok: false, error: 'رقم الهوية يجب أن يكون بين 5 و15 رقماً' };
  return { ok: true, id };
}

export function validateStudentCreate(
  form: StudentCreateForm,
  existingStudents: Student[]
): { ok: true; patch: StudentCreatePatch } | { ok: false; errors: StudentCreateErrors } {
  const errors: StudentCreateErrors = {};
  const idRes = validateNationalId(form.nationalId);
  if (idRes.ok === false) errors.nationalId = idRes.error;
  else {
    const id = idRes.id;
    const clash = existingStudents.some(s => normalizeNationalId(s.id) === id || normalizeNationalId(s.idNumber || '') === id);
    if (clash) errors.nationalId = 'رقم الهوية موجود مسبقاً لطالب آخر';
  }

  const editRes = validateStudentEdit({
    name: form.name,
    grade: form.grade,
    section: form.section,
    phone: form.phone,
    phone2: form.phone2,
  });
  if (editRes.ok === false) Object.assign(errors, editRes.errors);
  if (Object.keys(errors).length) return { ok: false, errors };

  const patch = (editRes as { ok: true; patch: StudentCreatePatch }).patch;
  const id = (idRes as { ok: true; id: string }).id;
  return { ok: true, patch: { ...patch, id } };
}

export function buildNewStudent(patch: StudentCreatePatch): Student {
  return {
    id: patch.id,
    idNumber: patch.id,
    name: patch.name,
    grade: patch.grade,
    section: patch.section,
    phone: patch.phone,
    phone2: patch.phone2,
    parentName: '',
  };
}

/** Returns a new list with the student appended; does not modify existing rows. */
export function applyStudentCreate(students: Student[], student: Student): Student[] {
  return [...students, student];
}
