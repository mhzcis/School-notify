import { describe, expect, it } from 'vitest';
import { applyColumnOverrides, canAssignField, mapRowToStudentFields, resolveHeaderMap } from './excelMapping';

// FAKE fixtures only (column layout mirrors the app's own sample template).
const TEMPLATE_HEADERS = [
  'المنطقة', 'المدرسة', 'الصف', 'الشعبة', 'نوع بطاقة التعريف', 'رقم بطاقة التعريف', 'رقم تسجيل الفرد',
  'رقم تسجيل العائلة', 'اسم الطالب', 'اسم الطالب انجليزي', 'حالة اللجوء', 'اسم ولي امر الطالب', 'اسم الأم',
  'مهنة ولي الأمر', 'مهنة الأم', 'جوال العائلة', 'تليفون العائلة', 'معدل الطالب العام السابق', 'ملاحظات أو مستحقات',
];

const fakeRow: Record<string, unknown> = {
  'المنطقة': 'منطقة وهمية', 'المدرسة': 'مدرسة وهمية', 'الصف': 'السابع', 'الشعبة': 'ب',
  'نوع بطاقة التعريف': 'هوية', 'رقم بطاقة التعريف': '000000001', 'رقم تسجيل الفرد': '1', 'رقم تسجيل العائلة': '2',
  'اسم الطالب': 'طالب تجريبي الاختبار', 'اسم الطالب انجليزي': 'Fake Test Student', 'حالة اللجوء': '-',
  'اسم ولي امر الطالب': 'ولي أمر تجريبي', 'اسم الأم': 'أم تجريبية', 'مهنة ولي الأمر': 'مهنة تجريبية',
  'مهنة الأم': '-', 'جوال العائلة': '0599000001', 'تليفون العائلة': '022000000',
  'معدل الطالب العام السابق': '90', 'ملاحظات أو مستحقات': 'لا شيء',
};

describe('resolveHeaderMap', () => {
  it('maps the app template headers exactly', () => {
    const map = resolveHeaderMap(TEMPLATE_HEADERS);
    expect(map['اسم الطالب']).toBe('name');
    expect(map['اسم الطالب انجليزي']).toBe('nameEn');
    expect(map['اسم ولي امر الطالب']).toBe('parentName');
    expect(map['رقم بطاقة التعريف']).toBe('idNumber');
    expect(map['جوال العائلة']).toBe('phone');
    expect(map['تليفون العائلة']).toBe('phone2');
    expect(map['الصف']).toBe('grade');
    expect(map['الشعبة']).toBe('section');
    expect(map['مهنة ولي الأمر']).toBeUndefined();
    expect(map['نوع بطاقة التعريف']).toBeUndefined();
    expect(map['اسم الأم']).toBeUndefined();
    expect(map['ملاحظات أو مستحقات']).toBeUndefined();
  });

  it('never takes the parent job column as the parent name, regardless of column order', () => {
    const map = resolveHeaderMap(['اسم الطالب', 'الصف', 'مهنة ولي الأمر', 'اسم ولي الأمر']);
    expect(map['مهنة ولي الأمر']).toBeUndefined();
    expect(map['اسم ولي الأمر']).toBe('parentName');
    const onlyJob = resolveHeaderMap(['اسم الطالب', 'الصف', 'مهنة ولي الأمر']);
    expect(Object.values(onlyJob)).not.toContain('parentName');
    const fuzzyJob = resolveHeaderMap(['اسم الطالب', 'الصف', 'وظيفة ولي الأمر الحالية']);
    expect(Object.values(fuzzyJob)).not.toContain('parentName');
  });

  it('never lets the English name column overwrite the Arabic name, regardless of column order', () => {
    const map = resolveHeaderMap(['اسم الطالب انجليزي', 'الصف', 'اسم الطالب']);
    expect(map['اسم الطالب']).toBe('name');
    expect(map['اسم الطالب انجليزي']).toBe('nameEn');
    const enOnly = resolveHeaderMap(['اسم الطالب بالانجليزي', 'الصف']);
    expect(Object.values(enOnly)).not.toContain('name');
  });

  it('uses guarded fuzzy matching for unusual but unambiguous headers', () => {
    const map = resolveHeaderMap(['اسم الطالب الرباعي', 'الصف الحالي', 'رقم جوال الأب']);
    expect(map['اسم الطالب الرباعي']).toBe('name');
    expect(map['الصف الحالي']).toBe('grade');
    expect(map['رقم جوال الأب']).toBe('phone');
  });

  it('maps each field from one column only', () => {
    const map = resolveHeaderMap(['الجوال', 'جوال العائلة', 'الصف', 'اسم الطالب']);
    expect(Object.values(map).filter(f => f === 'phone')).toHaveLength(1);
  });
});

describe('mapRowToStudentFields', () => {
  it('produces the right student fields from a fake row', () => {
    const s = mapRowToStudentFields(fakeRow, resolveHeaderMap(TEMPLATE_HEADERS));
    expect(s).toMatchObject({
      name: 'طالب تجريبي الاختبار',
      nameEn: 'Fake Test Student',
      parentName: 'ولي أمر تجريبي',
      id: '000000001',
      grade: 'السابع',
      section: 'ب',
      phone: '0599000001',
      phone2: '022000000',
    });
    expect(s.notes).toBeUndefined();
    expect(s.moodlePassword).toBeUndefined();
    expect(s.moodleUsername).toBeUndefined();
    expect(s.parentName).not.toBe('مهنة تجريبية');
  });

  it('skips empty cells', () => {
    const s = mapRowToStudentFields({ 'اسم الطالب': '  ', 'الصف': 'الأول' }, resolveHeaderMap(['اسم الطالب', 'الصف']));
    expect(s.name).toBeUndefined();
    expect(s.grade).toBe('الأول');
  });
});

describe('column review overrides', () => {
  it('refuses to bind an English-name header to the Arabic name, or a profession header to the parent name', () => {
    expect(canAssignField('اسم الطالب انجليزي', 'name')).toBe(false);
    expect(canAssignField('اسم الطالب', 'name')).toBe(true);
    expect(canAssignField('مهنة ولي الأمر', 'parentName')).toBe(false);
    expect(canAssignField('اسم ولي الأمر', 'parentName')).toBe(true);
    expect(canAssignField('كلمة المرور', 'name')).toBe(false);
    expect(canAssignField('ملاحظات', 'name')).toBe(false);
  });

  it('applies teacher overrides and ignores illegal or duplicate assignments', () => {
    const headers = ['اسم الطالب', 'اسم الطالب انجليزي', 'عمود حر'];
    const auto = resolveHeaderMap(headers);
    const map = applyColumnOverrides(headers, auto, { 'عمود حر': 'email', 'اسم الطالب انجليزي': 'name' });
    expect(map['اسم الطالب']).toBe('name');
    expect(map['اسم الطالب انجليزي']).toBe('nameEn'); // illegal override dropped, auto kept if still valid
    expect(map['عمود حر']).toBe('email');
    const ignored = applyColumnOverrides(headers, auto, { 'اسم الطالب': 'ignore' });
    expect(ignored['اسم الطالب']).toBeUndefined();
    expect(ignored['اسم الطالب انجليزي']).toBe('nameEn');
  });
});
