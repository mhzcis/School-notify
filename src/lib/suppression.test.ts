import { describe, expect, it } from 'vitest';
import { isSuppressed, maskPhone, parseSuppressed, suppressionSet } from './suppression';
import { buildDispatchItems } from './recipients';
import type { Student } from '../types';

const st = (id: string, phone: string, phone2 = ''): Student => ({ id, name: 'طالب ' + id, parentName: 'ولي', phone, phone2, grade: 'ص', section: 'أ' } as Student);

describe('suppression', () => {
  it('normalises phones and rejects invalid ones', () => {
    expect(parseSuppressed('+970 599-000-111', 'طلب ولي الأمر')).toEqual({ ok: true, entry: { phone: '0599000111', reason: 'طلب ولي الأمر' } });
    expect(parseSuppressed('123', '')).toEqual({ ok: false, error: 'invalid_phone' });
    expect(parseSuppressed('٠٥٩٩٠٠٠١١١', 'x'.repeat(500)).ok).toBe(true);
  });

  it('builds a set and matches any input format', () => {
    const s = suppressionSet([{ phone: '0599000111' }, { phone: 'bad' }]);
    expect(s.size).toBe(1);
    expect(isSuppressed('599000111', s)).toBe(true);
    expect(isSuppressed('00970599000111', s)).toBe(true);
    expect(isSuppressed('0599000112', s)).toBe(false);
  });

  it('dispatch excludes suppressed numbers with a visible reason', () => {
    const s = suppressionSet([{ phone: '0599000111' }]);
    const { items, excluded } = buildDispatchItems(
      [st('1', '0599000111'), st('2', '0599000222', '0599000111')], 'both', 'مرحبا', () => 'مرحبا', s,
    );
    expect(items.map(i => i.phone)).toEqual(['0599000222']);
    expect(excluded.filter(e => e.problem === 'suppressed')).toHaveLength(2);
  });

  it('masks phones', () => {
    expect(maskPhone('0599000111')).toBe('059****111');
  });
});
