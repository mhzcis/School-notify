import { describe, expect, it } from 'vitest';
import {
  classifyAssignmentStatus,
  classifyQuizState,
  detectMoodleKind,
  isDraft,
  isNeverLoggedIn,
  isNotAttempted,
  isNotSince,
  isNotSubmitted,
  parseLastAccess,
  parseMoodleFile,
} from './moodleCsv';

const now = new Date('2026-11-18T12:00:00+02:00');

const PARTICIPANTS = `ID number,First name,Surname,Last access to course,Groups
1000000001,طالب,تجريبي الأول,Never,رابع أ
1000000002,طالب,تجريبي الثاني,12 November 2026 10:00,رابع أ
1000000003,طالب,تجريبي الثالث,5 days 1 hour,رابع ب
`;

const PARTICIPANTS_AR = `رقم الهوية,الاسم,آخر دخول,الشعبة
1000000001,طالب تجريبي الأول,أبداً,أ
1000000004,طالب تجريبي الرابع,,أ
`;

const CUSTOM = `section,name,username
رابع أ,طالب تجريبي الأول,1000000001
رابع ب,طالب غير مسجل,1999999999
`;

const GRADING = `Identifier,Full name,ID number,Status,Grade
55,طالب تجريبي الأول,1000000001,No submission, -
56,طالب تجريبي الثاني,1000000002,Draft (not submitted), -
57,طالب تجريبي الثالث,1000000003,Submitted for grading,80
`;

const GRADING_AR = `الاسم الكامل,رقم الهوية,حالة التسليم
طالب تجريبي الأول,1000000001,لا يوجد تسليم
طالب تجريبي الثاني,1000000002,مسودة (لم يتم التسليم)
طالب تجريبي الثالث,1000000003,تم التسليم للتصحيح
`;

const QUIZ = `Surname,First name,ID number,State,Grade/10.00
تجريبي الأول,طالب,1000000001,Finished,8
تجريبي الثاني,طالب,1000000002,In progress, -
تجريبي الثالث,طالب,1000000003,Not attempted, -
`;

describe('Moodle CSV detection and last-access', () => {
  it('detects participants, grading and quiz from typical headers (EN + AR)', () => {
    expect(detectMoodleKind(['ID number', 'Last access to course']).kind).toBe('participants');
    expect(detectMoodleKind(['الاسم', 'آخر دخول']).kind).toBe('participants');
    expect(detectMoodleKind(['Identifier', 'Status', 'Grade']).kind).toBe('grading');
    expect(detectMoodleKind(['الاسم الكامل', 'حالة التسليم']).kind).toBe('grading');
    expect(detectMoodleKind(['State', 'Started on', 'Time taken']).kind).toBe('quiz');
  });

  it('parses never / relative / absolute last access', () => {
    expect(parseLastAccess('Never', now)).toEqual({ at: null, never: true });
    expect(parseLastAccess('أبداً', now).never).toBe(true);
    expect(parseLastAccess('', now).never).toBe(true);
    const rel = parseLastAccess('5 days 1 hour', now);
    expect(rel.never).toBe(false);
    expect(rel.at && (now.getTime() - rel.at.getTime()) / 86400000).toBeGreaterThan(4.9);
    const abs = parseLastAccess('12 November 2026 10:00', now);
    expect(abs.never).toBe(false);
    expect(abs.at?.getUTCFullYear()).toBe(2026);
  });
});

describe('parseMoodleFile participants', () => {
  it('builds never-logged-in vs older-than-X from a participants CSV (fake IDs only)', () => {
    const parsed = parseMoodleFile({ text: PARTICIPANTS }, { now });
    expect(parsed.kind).toBe('participants');
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0].nationalId).toBe('1000000001');
    expect(isNeverLoggedIn(parsed.rows[0])).toBe(true);
    expect(isNotSince(parsed.rows[0], 7, now)).toBe(true);
    expect(isNeverLoggedIn(parsed.rows[1])).toBe(false);
    expect(isNotSince(parsed.rows[1], 7, now)).toBe(false);
    expect(isNotSince(parsed.rows[2], 3, now)).toBe(true);
  });

  it('accepts Arabic headers and empty last-access as never', () => {
    const parsed = parseMoodleFile({ text: PARTICIPANTS_AR }, { now });
    expect(parsed.kind).toBe('participants');
    expect(parsed.rows[0].neverAccessed).toBe(true);
    expect(parsed.rows[1].neverAccessed).toBe(true);
  });

  it('treats a custom username column of digits as the national ID', () => {
    const parsed = parseMoodleFile({ text: CUSTOM }, { kind: 'participants', now });
    expect(parsed.rows[0].nationalId).toBe('1000000001');
    expect(parsed.rows[1].nationalId).toBe('1999999999');
    expect(parsed.rows[0].fullName).toBe('طالب تجريبي الأول');
  });
});

describe('grading + quiz status vocabularies', () => {
  it('classifies explicit EN and AR statuses (no fuzzy guess on unknown text)', () => {
    expect(classifyAssignmentStatus('No submission')).toBe('no_submission');
    expect(classifyAssignmentStatus('Draft (not submitted)')).toBe('draft');
    expect(classifyAssignmentStatus('Submitted for grading')).toBe('submitted');
    expect(classifyAssignmentStatus('لا يوجد تسليم')).toBe('no_submission');
    expect(classifyAssignmentStatus('مسودة (لم يتم التسليم)')).toBe('draft');
    expect(classifyAssignmentStatus('تم التسليم للتصحيح')).toBe('submitted');
    expect(classifyAssignmentStatus('something else')).toBe('other');
    expect(classifyQuizState('Finished')).toBe('finished');
    expect(classifyQuizState('In progress')).toBe('in_progress');
    expect(classifyQuizState('Not attempted')).toBe('not_attempted');
    expect(classifyQuizState('لم يحاول')).toBe('not_attempted');
  });

  it('yields the expected fake ID sets from a grading worksheet', () => {
    const en = parseMoodleFile({ text: GRADING }, { now });
    expect(en.kind).toBe('grading');
    expect(en.rows.filter(isNotSubmitted).map(r => r.nationalId)).toEqual(['1000000001']);
    expect(en.rows.filter(isDraft).map(r => r.nationalId)).toEqual(['1000000002']);
    expect(en.rows[0].gradeText).toBeTruthy();
    const ar = parseMoodleFile({ text: GRADING_AR }, { now });
    expect(ar.rows.filter(isNotSubmitted).map(r => r.nationalId)).toEqual(['1000000001']);
    expect(ar.rows.filter(isDraft).map(r => r.nationalId)).toEqual(['1000000002']);
  });

  it('yields not-attempted IDs from a quiz report', () => {
    const parsed = parseMoodleFile({ text: QUIZ }, { now });
    expect(parsed.kind).toBe('quiz');
    expect(parsed.rows.filter(isNotAttempted).map(r => r.nationalId)).toEqual(['1000000003']);
    expect(parsed.rows.find(r => r.nationalId === '1000000001')?.quizState).toBe('finished');
  });

  it('does not treat a password-looking column as a student field (parsers expose no password key)', () => {
    const parsed = parseMoodleFile({
      text: 'ID number,Password,Last access to course\n1000000001,Fake#Pass-0001,Never\n',
    }, { now });
    expect(parsed.rows[0].nationalId).toBe('1000000001');
    expect(JSON.stringify(parsed.rows[0])).not.toContain('Fake#Pass-0001');
    expect((parsed.rows[0] as any).moodlePassword).toBeUndefined();
  });
});
