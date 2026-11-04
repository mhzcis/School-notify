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

describe('renderTemplate', () => {
  it('uses the FULL student name for {{اسم_الطالب}}', () => {
    expect(renderTemplate('الطالب {{اسم_الطالب}}', fakeStudent, { today: day })).toBe('الطالب طالب تجريبي الاختبار');
  });

  it('supports the optional {{الاسم_الأول}}', () => {
    expect(renderTemplate('مرحبا {{الاسم_الأول}}', fakeStudent)).toBe('مرحبا طالب');
    expect(firstName('')).toBe('');
  });

  it('renders all other placeholders, repeated occurrences and default notes', () => {
    const out = renderTemplate('{{اسم_ولي_الأمر}} | {{الصف}} | {{الشعبة}} | {{ملاحظات}} | {{الصف}}', fakeStudent, { today: day });
    expect(out).toBe('ولي أمر تجريبي | الصف السابع | ب | لا يوجد مستحقات متأخرة | الصف السابع');
  });

  it('renders the date and leaves unknown placeholders untouched', () => {
    const out = renderTemplate('{{اليوم}} {{غير_معروف}}', fakeStudent, { today: day });
    expect(out.startsWith(formatArabicDate(day))).toBe(true);
    expect(out).toContain('{{غير_معروف}}');
  });

  it('never prints "undefined" for missing fields', () => {
    expect(renderTemplate('{{اسم_ولي_الأمر}}-{{الشعبة}}', { name: 'س' })).toBe('-');
  });

  it('exposes every placeholder that the renderer understands', () => {
    for (const p of PLACEHOLDERS) {
      expect(renderTemplate(p.tag, fakeStudent, { today: day })).not.toBe(p.tag);
    }
  });
});
