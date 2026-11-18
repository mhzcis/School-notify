import { describe, expect, it } from 'vitest';
import { parseMoodleFile } from './moodleCsv';
import { countBySection, matchMoodleRows, resolveAmbiguous } from './moodleMatch';
import { fakeStudent } from '../test/fixtures';

const now = new Date('2026-11-18T12:00:00+02:00');

const students = [
  fakeStudent(1, { name: 'طالب تجريبي الأول', grade: 'رابع', section: 'أ' }),
  fakeStudent(2, { name: 'طالب تجريبي الثاني', grade: 'رابع', section: 'أ' }),
  fakeStudent(3, { name: 'طالب تجريبي الثالث', grade: 'رابع', section: 'ب' }),
  fakeStudent(5, { name: 'طالب تجريبي الخامس', nameEn: 'Fake Student Five', grade: 'رابع', section: 'ب' }),
  // Two students sharing the same Arabic name — name match must stay ambiguous.
  fakeStudent(8, { name: 'طالب متشابه', grade: 'رابع', section: 'أ' }),
  fakeStudent(9, { name: 'طالب متشابه', grade: 'رابع', section: 'ب' }),
];

describe('matchMoodleRows', () => {
  it('matches by national ID and lists unmatched IDs; ID beats a conflicting name', () => {
    const csv = `ID number,Full name,Last access to course,Groups
1000000001,اسم مختلف تماما,Never,أ
1999999999,طالب غير موجود,Never,أ
`;
    const parsed = parseMoodleFile({ text: csv }, { now });
    const result = matchMoodleRows(parsed.rows, students);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].studentId).toBe('1000000001');
    expect(result.matched[0].how).toBe('national_id');
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0].nationalId).toBe('1999999999');
  });

  it('falls back to a unique exact name only when no ID matches, and never auto-picks duplicates', () => {
    const csv = `Full name,Last access to course
طالب تجريبي الثاني,Never
طالب متشابه,Never
شخص مجهول,Never
`;
    const parsed = parseMoodleFile({ text: csv }, { kind: 'participants', now });
    const result = matchMoodleRows(parsed.rows, students);
    expect(result.matched.map(m => m.studentId)).toEqual(['1000000002']);
    expect(result.matched[0].how).toBe('name');
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].candidateIds.sort()).toEqual(['1000000008', '1000000009']);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0].fullName).toBe('شخص مجهول');

    const resolved = resolveAmbiguous(result, 0, '1000000008');
    expect(resolved.matchedIds).toContain('1000000008');
    expect(resolved.ambiguous).toHaveLength(0);
  });

  it('groups never-logged-in counts per registered section', () => {
    const csv = `ID number,Last access to course
1000000001,Never
1000000002,12 November 2026 10:00
1000000003,Never
`;
    const parsed = parseMoodleFile({ text: csv }, { now });
    const result = matchMoodleRows(parsed.rows, students);
    const counts = countBySection(result.matched, students, { notSinceDays: 7, now });
    const a = counts.find(c => c.label === 'رابع أ')!;
    const b = counts.find(c => c.label === 'رابع ب')!;
    expect(a.neverLoggedIn).toEqual(['1000000001']);
    expect(b.neverLoggedIn).toEqual(['1000000003']);
    expect(a.notSince.sort()).toEqual(['1000000001']);
  });
});
