import { describe, expect, it } from 'vitest';
import { applyStudentEdit, studentToEditForm, validateStudentEdit } from './studentEdit';
import { fakeStudent, fakeStudents } from '../test/fixtures';

const form = (o: Partial<ReturnType<typeof studentToEditForm>> = {}) => ({
  ...studentToEditForm(fakeStudent(1, { phone: '0590000001', phone2: '' })),
  ...o,
});

describe('validateStudentEdit', () => {
  it('normalises valid phones to 05XXXXXXXX and trims fields', () => {
    const r = validateStudentEdit(form({ name: '  طالب   تجريبي ', phone: '+970 59-000-0002', phone2: '٠٥٩٠٠٠٠٠٠٣', section: ' ب ' }));
    expect(r).toEqual({ ok: true, patch: { name: 'طالب تجريبي', grade: 'العاشر', section: 'ب', phone: '0590000002', phone2: '0590000003' } });
  });

  it('requires a name', () => {
    const r = validateStudentEdit(form({ name: '  ' }));
    expect(r.ok).toBe(false);
    expect((r as any).errors.name).toBeTruthy();
  });

  it('rejects invalid, landline and placeholder numbers', () => {
    for (const bad of ['12345', '022345678', '0590000000']) {
      const r = validateStudentEdit(form({ phone: bad }));
      expect(r.ok).toBe(false);
      expect((r as any).errors.phone).toBeTruthy();
    }
    const r2 = validateStudentEdit(form({ phone2: 'abc' }));
    expect((r2 as any).errors.phone2).toBeTruthy();
  });

  it('allows an empty phone 1 when phone 2 is valid, but requires at least one phone', () => {
    expect(validateStudentEdit(form({ phone: '', phone2: '0590000004' }))).toMatchObject({ ok: true, patch: { phone: '', phone2: '0590000004' } });
    const r = validateStudentEdit(form({ phone: '', phone2: '' }));
    expect(r.ok).toBe(false);
    expect((r as any).errors.form).toBeTruthy();
  });
});

describe('applyStudentEdit', () => {
  it('changes only the edited student; count, order and other fields unchanged', () => {
    const before = fakeStudents(5).map(s => ({ ...s, notes: 'ملاحظة تجريبية', phone2: '0590000099' }));
    const after = applyStudentEdit(before, before[2].id, { name: 'طالب تجريبي معدل', grade: 'التاسع', section: 'ج', phone: '0590000098', phone2: '' });
    expect(after).toHaveLength(5);
    expect(after.map(s => s.id)).toEqual(before.map(s => s.id));
    after.forEach((s, i) => { if (i !== 2) expect(s).toBe(before[i]); });
    expect(after[2]).toEqual({ ...before[2], name: 'طالب تجريبي معدل', grade: 'التاسع', section: 'ج', phone: '0590000098', phone2: '' });
    expect(after[2].notes).toBe('ملاحظة تجريبية');
  });

  it('is a no-op for an unknown id', () => {
    const before = fakeStudents(3);
    expect(applyStudentEdit(before, 'nope', { name: 'x', grade: '', section: '', phone: '0590000001', phone2: '' })).toEqual(before);
  });
});
