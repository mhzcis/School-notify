// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import SectionCalendar from './SectionCalendar';
import { buildSectionEvent } from '../lib/sectionEvents';
import { fakeStudent } from '../test/fixtures';
import { QUIZ_REMINDER_TEMPLATE } from '../lib/moodleTemplates';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('SectionCalendar', () => {
  it('shows this week\'s close dates and prepares (never sends) a section reminder', () => {
    const students = [fakeStudent(1, { grade: 'العاشر', section: 'أ' }), fakeStudent(2, { grade: 'العاشر', section: 'ب' })];
    const ev = buildSectionEvent({ grade: 'العاشر', section: 'أ', title: 'اختبار تجريبي', closeAt: '2026-11-19T20:00:00Z' });
    const onPrepare = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    act(() => createRoot(el).render(<SectionCalendar events={[ev]} students={students} onPrepareCampaign={onPrepare} now={new Date('2026-11-18T10:00:00Z')} />));
    expect(el.querySelector('[data-day="2026-11-19"] [data-event]')).not.toBeNull();
    act(() => (el.querySelector(`[data-prepare="${ev.id}"]`) as HTMLButtonElement).click());
    expect(onPrepare).toHaveBeenCalledTimes(1);
    expect(onPrepare.mock.calls[0][0].studentIds).toEqual([students[0].id]);
    expect(onPrepare.mock.calls[0][0].content).toBe(QUIZ_REMINDER_TEMPLATE.content);
    act(() => (el.querySelector('#cal-next') as HTMLButtonElement).click());
    expect(el.querySelector('[data-event]')).toBeNull();
    el.remove();
  });
});
