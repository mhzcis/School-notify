import { describe, expect, it } from 'vitest';
import { applyStudentCreate, buildNewStudent, validateStudentCreate } from './studentCreate';
import { fakeStudents } from '../test/fixtures';

const form = {
  nationalId: '2000000099',
  name: 'طالب تجريبي جديد',
  grade: 'الرابع',
  section: '3',
  phone: '0590000099',
  phone2: '',
};

describe('validateStudentCreate', () => {
  it('accepts a valid form with a mandatory national ID and normalises it', () => {
    const r = validateStudentCreate({ ...form, nationalId: '٢٠٠٠٠٠٠٠٩٩' }, fakeStudents(3));
    expect(r).toMatchObject({
      ok: true,
      patch: { id: '2000000099', name: 'طالب تجريبي جديد', grade: 'الرابع', section: '3', phone: '0590000099', phone2: '' },
    });
  });

  it('requires a national ID and rejects a duplicate', () => {
    const missing = validateStudentCreate({ ...form, nationalId: '  ' }, fakeStudents(3));
    expect(missing.ok).toBe(false);
    expect((missing as any).errors.nationalId).toBeTruthy();
    const dup = validateStudentCreate({ ...form, nationalId: '1000000002' }, fakeStudents(3));
    expect(dup.ok).toBe(false);
    expect((dup as any).errors.nationalId).toMatch(/موجود/);
  });

  it('reuses the same phone/name rules as edit', () => {
    const r = validateStudentCreate({ ...form, name: '  ', phone: '' }, []);
    expect(r.ok).toBe(false);
    expect((r as any).errors.name).toBeTruthy();
    expect((r as any).errors.form).toBeTruthy();
  });
});

describe('applyStudentCreate', () => {
  it('appends exactly one student and leaves the others untouched', () => {
    const before = fakeStudents(4);
    const student = buildNewStudent({
      id: '2000000099', name: 'طالب تجريبي جديد', grade: 'الرابع', section: '3', phone: '0590000099', phone2: '',
    });
    const after = applyStudentCreate(before, student);
    expect(after).toHaveLength(5);
    expect(after.slice(0, 4)).toEqual(before);
    expect(after[4]).toMatchObject({ id: '2000000099', idNumber: '2000000099', name: 'طالب تجريبي جديد' });
    expect(after[4].notes).toBeUndefined();
  });
});
