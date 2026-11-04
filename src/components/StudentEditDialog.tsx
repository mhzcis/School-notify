/**
 * Modal form to edit ONE student: name, grade, section, phone 1, phone 2 (no notes field).
 */
import React, { useEffect, useState } from 'react';
import type { Student } from '../types';
import { StudentEditErrors, StudentEditForm, StudentEditPatch, studentToEditForm, validateStudentEdit } from '../lib/studentEdit';

interface Props {
  student: Student | null;
  onCancel: () => void;
  /** Persists the edit; resolve true on success (dialog closes), false on failure (dialog stays open). */
  onSave: (id: string, patch: StudentEditPatch) => Promise<boolean>;
}

const FIELDS: Array<{ key: keyof StudentEditForm; label: string; placeholder?: string; mono?: boolean }> = [
  { key: 'name', label: 'الاسم' },
  { key: 'grade', label: 'الصف' },
  { key: 'section', label: 'الشعبة' },
  { key: 'phone', label: 'الرقم 1 (الرئيسي)', placeholder: '05XXXXXXXX', mono: true },
  { key: 'phone2', label: 'الرقم 2 (البديل)', placeholder: '05XXXXXXXX — اختياري', mono: true },
];

export default function StudentEditDialog({ student, onCancel, onSave }: Props) {
  const [form, setForm] = useState<StudentEditForm | null>(null);
  const [errors, setErrors] = useState<StudentEditErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(student ? studentToEditForm(student) : null);
    setErrors({});
    setSaving(false);
  }, [student]);

  if (!student || !form) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = validateStudentEdit(form);
    if (res.ok === false) {
      setErrors(res.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    const ok = await onSave(student.id, res.patch);
    setSaving(false);
    if (ok) onCancel();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      dir="rtl"
      onClick={e => { e.stopPropagation(); if (!saving) onCancel(); }}
      id="student-edit-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-edit-title"
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 text-right"
      >
        <h3 id="student-edit-title" className="font-black text-slate-800 text-sm">تعديل بيانات طالب</h3>
        <p className="text-[11px] text-slate-500">يُحفظ التعديل لهذا الطالب فقط. يكفي رقم جوال صالح واحد على الأقل.</p>
        {FIELDS.map(f => (
          <div key={f.key}>
            <label htmlFor={`edit-${f.key}`} className="block text-xs font-bold text-slate-700 mb-1">{f.label}</label>
            <input
              id={`edit-${f.key}`}
              value={form[f.key]}
              placeholder={f.placeholder}
              dir={f.mono ? 'ltr' : 'rtl'}
              inputMode={f.mono ? 'tel' : undefined}
              onChange={e => setForm({ ...form, [f.key]: e.target.value })}
              className={`w-full p-2 bg-slate-50 border rounded-lg text-xs ${f.mono ? 'font-mono text-left' : ''} ${errors[f.key] ? 'border-rose-400' : 'border-slate-200 focus:border-indigo-500'}`}
            />
            {errors[f.key] && <p className="text-[11px] text-rose-600 mt-1" role="alert">{errors[f.key]}</p>}
          </div>
        ))}
        {errors.form && <p className="text-[11px] text-rose-600" role="alert">{errors.form}</p>}
        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 rounded-xl text-xs font-black bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer">
            {saving ? 'جارٍ الحفظ…' : 'حفظ'}
          </button>
          <button type="button" disabled={saving} onClick={onCancel} className="flex-1 px-4 py-2 rounded-xl text-xs font-black bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer">
            إلغاء
          </button>
        </div>
      </form>
    </div>
  );
}
