import { describe, expect, it } from 'vitest';
import { eventsForDays, localWeekday, sectionStudentIds, undatedEvents, weekDays } from './sectionCalendar';
import { buildSectionEvent } from './sectionEvents';
import { fakeStudent } from '../test/fixtures';

const now = new Date('2026-11-18T10:00:00Z'); // Wednesday in Asia/Jerusalem

describe('sectionCalendar', () => {
  it('weeks start on Sunday in Asia/Jerusalem', () => {
    expect(localWeekday(now)).toBe(3);
    expect(weekDays(now)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
    expect(weekDays(now, 1)[0]).toBe('2026-11-22');
    // 23:30 UTC Saturday is already Sunday in Jerusalem
    expect(weekDays(new Date('2026-11-21T23:30:00Z'))[0]).toBe('2026-11-22');
  });

  it('places events on their local close day with a day-before reminder', () => {
    const e1 = buildSectionEvent({ grade: 'العاشر', section: 'أ', title: 'اختبار 1', closeAt: '2026-11-19T21:59:00Z' });
    const e2 = buildSectionEvent({ grade: 'العاشر', section: 'ب', title: 'اختبار 2', closeAt: '2026-12-30T10:00:00Z' });
    const e3 = buildSectionEvent({ grade: 'العاشر', section: 'ج', title: 'بدون تاريخ', closeLabel: 'الخميس' });
    const list = eventsForDays([e2, e1, e3], weekDays(now));
    expect(list).toHaveLength(1);
    expect(list[0].day).toBe('2026-11-19');
    expect(list[0].reminderDay).toBe('2026-11-18');
    expect(undatedEvents([e1, e2, e3]).map(e => e.title)).toEqual(['بدون تاريخ']);
  });

  it('selects only students of that section', () => {
    const students = [fakeStudent(1, { grade: 'العاشر', section: 'أ' }), fakeStudent(2, { grade: 'العاشر', section: 'ب' }), fakeStudent(3, { grade: 'التاسع', section: 'أ' })];
    expect(sectionStudentIds({ grade: 'العاشر', section: 'أ' }, students)).toEqual([students[0].id]);
  });
});
