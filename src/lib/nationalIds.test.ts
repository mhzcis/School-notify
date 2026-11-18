import { describe, expect, it } from 'vitest';
import { matchStudentsByNationalIds, parseNationalIds } from './nationalIds';
import { fakeStudent, fakeStudents } from '../test/fixtures';

describe('parseNationalIds', () => {
  it('splits on whitespace, commas and newlines and uniques the result', () => {
    expect(parseNationalIds('1000000001, 1000000002\n1000000001  1000000003')).toEqual([
      '1000000001', '1000000002', '1000000003',
    ]);
  });

  it('accepts Arabic-Indic digits', () => {
    expect(parseNationalIds('١٠٠٠٠٠٠٠٠١')).toEqual(['1000000001']);
  });

  it('returns an empty list for empty or non-id text (never "all")', () => {
    expect(parseNationalIds('')).toEqual([]);
    expect(parseNationalIds('   , \n')).toEqual([]);
    expect(parseNationalIds('abc')).toEqual([]);
  });
});

describe('matchStudentsByNationalIds', () => {
  const students = fakeStudents(4);

  it('selects exactly the known IDs and reports unknown ones', () => {
    const r = matchStudentsByNationalIds(students, '1000000001 1000000004 1999999999 1000000001');
    expect(r.matchedIds).toEqual(['1000000001', '1000000004']);
    expect(r.unknownIds).toEqual(['1999999999']);
    expect(r.duplicateIds).toEqual(['1000000001']);
  });

  it('matches idNumber as well as id, and leaves selection empty on an empty paste', () => {
    const withNumber = [fakeStudent(9, { id: 'SID-9', idNumber: '2000000009' })];
    const r = matchStudentsByNationalIds(withNumber, '2000000009');
    expect(r.matchedIds).toEqual(['SID-9']);
    expect(matchStudentsByNationalIds(students, '').matchedIds).toEqual([]);
    expect(matchStudentsByNationalIds(students, '').unknownIds).toEqual([]);
  });
});
