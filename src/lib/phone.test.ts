import { describe, expect, it } from 'vitest';
import { checkPhone, isSendablePhone, toInternational } from './phone';
import { buildDispatchItems } from './recipients';
import type { Student } from '../types';

// FAKE numbers only.
describe('checkPhone', () => {
  it.each([
    ['0599000123', '0599000123'],
    ['599000123', '0599000123'],
    ['+970599000123', '0599000123'],
    ['00970599000123', '0599000123'],
    ['970 59 900 0123', '0599000123'],
    ['+972 56-900-0123', '0569000123'],
    ['٠٥٩٩٠٠٠١٢٣', '0599000123'],
    [599000123, '0599000123'],
  ])('normalises %s', (input, expected) => {
    const r = checkPhone(input);
    expect(r.valid).toBe(true);
    expect(r.local).toBe(expected);
  });

  it('flags missing, invalid, landline and placeholder numbers', () => {
    expect(checkPhone('').problem).toBe('missing');
    expect(checkPhone(undefined).problem).toBe('missing');
    expect(checkPhone('12345').problem).toBe('invalid');
    expect(checkPhone('059912345678').problem).toBe('invalid');
    expect(checkPhone('022000000').problem).toBe('landline');
    expect(checkPhone('0590000000').problem).toBe('placeholder');
    expect(checkPhone('0599999999').problem).toBe('placeholder');
    expect(isSendablePhone('0590000000')).toBe(false);
  });

  it('builds the international form', () => {
    expect(toInternational('0599000123')).toBe('+970599000123');
    expect(toInternational('+972569000123')).toBe('+972569000123');
    expect(toInternational('bad')).toBe('');
  });
});

const fake = (id: string, phone: string, phone2 = ''): Student => ({
  id, name: `طالب ${id}`, parentName: 'ولي', phone, phone2, grade: 'الأول', section: 'أ',
});

describe('buildDispatchItems', () => {
  const students = [fake('A', '0599000001', '0569000001'), fake('B', ''), fake('C', '0590000000', '0599000003'), fake('D', '599000004', '0599000004')];

  it('excludes students without a valid primary phone and never uses a fallback number', () => {
    const { items, excluded } = buildDispatchItems(students, 'primary', 'x');
    expect(items.map(i => i.studentId)).toEqual(['A', 'D']);
    expect(items.map(i => i.phone)).toEqual(['0599000001', '0599000004']);
    expect(excluded.map(e => [e.studentId, e.problem])).toEqual([['B', 'missing'], ['C', 'placeholder']]);
    expect(items.some(i => i.phone === '0590000000')).toBe(false);
  });

  it('secondary target excludes missing secondary numbers', () => {
    const { items, excluded } = buildDispatchItems(students, 'secondary', 'x');
    expect(items.map(i => i.studentId)).toEqual(['A', 'C', 'D']);
    expect(excluded.map(e => e.studentId)).toEqual(['B']);
  });

  it('both: dedupes identical numbers and silently skips an empty secondary', () => {
    const { items, excluded } = buildDispatchItems(students, 'both', 'x');
    expect(items.filter(i => i.studentId === 'D')).toHaveLength(1);
    expect(items.filter(i => i.studentId === 'A')).toHaveLength(2);
    expect(excluded.map(e => [e.studentId, e.which])).toEqual([['B', 'primary'], ['C', 'primary']]);
  });

  it('renders content per student', () => {
    const { items } = buildDispatchItems([fake('A', '0599000001')], 'primary', 'مرحبا {{اسم_الطالب}}');
    expect(items[0].content).toBe('مرحبا طالب A');
  });
});
