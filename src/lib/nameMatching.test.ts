import { describe, expect, it } from 'vitest';
import { matchNames, normalizeName } from './nameMatching';
import type { Student } from '../types';

// FAKE fixtures only.
const st = (id: string, name: string, nameEn?: string): Student => ({
  id, name, nameEn, parentName: '-', phone: '0599000001', grade: 'الأول', section: 'أ',
});
const students = [
  st('1', 'سامر خالد تجريبي', 'Samer Khaled Test'),
  st('2', 'سامر خالد تجريبي المختبر'),
  st('3', 'لينا فادي وهمي'),
  st('4', 'لينا فادي وهمي'),
  st('5', 'أسامة إبراهيم مثال'),
];

describe('normalizeName', () => {
  it('unifies alef/teh marbuta/diacritics/spaces', () => {
    expect(normalizeName('  أُسامةُ   إبراهيم ')).toBe('اسامه ابراهيم');
  });
});

describe('matchNames', () => {
  it('auto-selects only exact normalised matches', () => {
    const r = matchNames(['سامر خالد تجريبي', 'اسامه ابراهيم مثال', 'samer khaled test'], students);
    expect(r.matched.map(m => m.studentId)).toEqual(['1', '5', '1']);
    expect(r.matchedIds).toEqual(['1', '5']);
    expect(r.ambiguous).toHaveLength(0);
  });

  it('a shorter name that is contained in several students is NOT auto-picked', () => {
    const r = matchNames(['سامر خالد'], students);
    expect(r.matchedIds).toEqual([]);
    expect(r.ambiguous[0]).toEqual({ raw: 'سامر خالد', candidateIds: ['1', '2'], reason: 'partial' });
  });

  it('a longer name containing a registered name is a suggestion, not a match', () => {
    const r = matchNames(['لينا فادي وهمي الإضافي'], [students[2]]);
    expect(r.matchedIds).toEqual([]);
    expect(r.ambiguous[0].candidateIds).toEqual(['3']);
  });

  it('duplicate registered names are listed for manual choice', () => {
    const r = matchNames(['لينا فادي وهمي'], students);
    expect(r.matchedIds).toEqual([]);
    expect(r.ambiguous[0]).toMatchObject({ candidateIds: ['3', '4'], reason: 'duplicate' });
  });

  it('substring of a word does not match (old .includes() bug)', () => {
    const r = matchNames(['سام'], students);
    expect(r.unmatched).toEqual(['سام']);
  });
});
