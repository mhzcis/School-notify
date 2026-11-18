import { describe, expect, it } from 'vitest';
import { firstName, formatArabicDate, renderTemplate, PLACEHOLDERS } from './template';

// FAKE fixture only.
const fakeStudent = {
  id: 'FAKE-1',
  name: '  طالب   تجريبي   الاختبار ',
  parentName: 'ولي أمر تجريبي',
  grade: 'الصف السابع',
  section: 'ب',
  notes: '',
  phone: '0599000001',
};
const day = new Date(2026, 10, 4);

describe('firstName (compound Arabic names)', () => {
  it('keeps عبد / أبو / ابو with the following token', () => {
    expect(firstName('عبد الرحمن تجريبي الاختبار')).toBe('عبد الرحمن');
    expect(firstName('ابو علي تجريبي')).toBe('ابو علي');
    expect(firstName('أبو علي تجريبي')).toBe('أبو علي');
    expect(firstName('أبا حسن تجريبي')).toBe('أبا حسن');
    expect(firstName('عبدال كريم تجريبي')).toBe('عبدال كريم');
  });

  it('returns a lone prefix or a normal first word as-is', () => {
    expect(firstName('أبو')).toBe('أبو');
    expect(firstName('طالب تجريبي الاختبار')).toBe('طالب');
    expect(firstName('')).toBe('');
    expect(firstName('عبدالله تجريبي')).toBe('عبدالله'); // already one token
  });
});

describe('renderTemplate', () => {
  it('uses the FULL student name for {{اسم_الطالب}} and {{الاسم_الكامل}}', () => {
    expect(renderTemplate('الطالب {{اسم_الطالب}}', fakeStudent, { today: day })).toBe('الطالب طالب تجريبي الاختبار');
    expect(renderTemplate('الطالب {{الاسم_الكامل}}', fakeStudent, { today: day })).toBe('الطالب طالب تجريبي الاختبار');
  });

  it('supports the optional {{الاسم_الأول}} with compound names', () => {
    expect(renderTemplate('مرحبا {{الاسم_الأول}}', fakeStudent)).toBe('مرحبا طالب');
    expect(renderTemplate('مرحبا {{الاسم_الأول}}', { ...fakeStudent, name: 'عبد الرحمن تجريبي' })).toBe('مرحبا عبد الرحمن');
  });

  it('renders other placeholders and repeated occurrences; empty notes stay empty', () => {
    const out = renderTemplate('{{اسم_ولي_الأمر}} | {{الصف}} | {{الشعبة}} | {{ملاحظات}} | {{الصف}}', fakeStudent, { today: day });
    expect(out).toBe('ولي أمر تجريبي | الصف السابع | ب |  | الصف السابع');
  });

  it('renders the date and leaves unknown placeholders untouched', () => {
    const out = renderTemplate('{{اليوم}} {{غير_معروف}}', fakeStudent, { today: day });
    expect(out.startsWith(formatArabicDate(day))).toBe(true);
    expect(out).toContain('{{غير_معروف}}');
  });

  it('never prints "undefined" for missing fields', () => {
    expect(renderTemplate('{{اسم_ولي_الأمر}}-{{الشعبة}}', { name: 'س' })).toBe('-');
  });

  it('exposes every placeholder that the picker lists', () => {
    for (const p of PLACEHOLDERS) {
      expect(renderTemplate(p.tag, fakeStudent, { today: day })).not.toBe(p.tag);
    }
  });
});
