import { describe, expect, it } from 'vitest';
import {
  alreadySentKeys,
  blocksAutosendForCredentials,
  dispatchKey,
  evaluateCampaign,
  parseScheduledTime,
  remainingItems,
  resolveTargets,
  shouldSkipQuietHours,
  sliceForRun,
  timeZoneOffsetMs,
  typedEnableMatches,
  TYPED_ENABLE_WORD,
} from './scheduledSend';
import { fakeStudent } from '../test/fixtures';
import type { ScheduledMessage } from '../types';

function campaign(partial: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'حملة تجريبية',
    contentTemplate: 'مرحبا {{اسم_الطالب}}',
    targetType: 'custom',
    targetStudentIds: ['1000000001'],
    scheduledTime: '2026-11-18T10:00:00',
    status: 'pending',
    createdAt: '2026-11-17T10:00:00.000Z',
    totalRecipients: 1,
    ...partial,
  };
}

describe('parseScheduledTime (Asia/Jerusalem wall time)', () => {
  it('treats a naive timestamp as Jerusalem time, not UTC', () => {
    const d = parseScheduledTime('2026-11-18T22:00:00');
    expect(d).toBeTruthy();
    // 22:00 in Jerusalem in mid-November is UTC+2 → 20:00Z
    expect(d!.toISOString()).toBe('2026-11-18T20:00:00.000Z');
    const offset = timeZoneOffsetMs(d!.getTime());
    expect(offset).toBe(2 * 60 * 60 * 1000);
  });

  it('keeps an explicit Z timestamp as UTC', () => {
    expect(parseScheduledTime('2026-11-18T22:00:00Z')!.toISOString()).toBe('2026-11-18T22:00:00.000Z');
  });
});

describe('evaluateCampaign', () => {
  const now = new Date('2026-11-18T12:00:00.000Z'); // 14:00 Jerusalem, not quiet hours

  it('is due only when pending and scheduledTime has passed', () => {
    expect(evaluateCampaign(campaign({ scheduledTime: '2026-11-18T10:00:00' }), now).ok).toBe(true);
    expect(evaluateCampaign(campaign({ scheduledTime: '2026-11-18T16:00:00' }), now).ok).toBe(false); // 16:00 Jerusalem = 14:00Z, after 12:00Z? 16:00 J = 14:00Z > 12:00Z, not due
    expect(evaluateCampaign(campaign({ status: 'completed' }), now).ok).toBe(false);
    expect(evaluateCampaign(campaign({ archived: true }), now).ok).toBe(false);
  });

  it('skips quiet hours unless the teacher overrode them when scheduling', () => {
    const quietNow = new Date('2026-11-18T21:30:00.000Z'); // 23:30 Jerusalem
    expect(shouldSkipQuietHours(campaign(), quietNow)).toBe(true);
    expect(evaluateCampaign(campaign(), quietNow)).toEqual({ ok: false, reason: 'quiet_hours' });
    expect(evaluateCampaign(campaign({ quietHoursOverride: true }), quietNow).ok).toBe(true);
  });

  it('refuses to auto-send a credentials template without the explicit flag', () => {
    const secret = campaign({ contentTemplate: 'كلمة {{كلمة_المرور}}' });
    expect(blocksAutosendForCredentials(secret.contentTemplate, false)).toBe(true);
    expect(evaluateCampaign(secret, now)).toEqual({ ok: false, reason: 'credentials' });
    expect(evaluateCampaign({ ...secret, allowCredentialsAutosend: true }, now).ok).toBe(true);
  });
});

describe('targets, idempotency, and caps', () => {
  const students = [
    fakeStudent(1, { grade: 'رابع', section: 'أ' }),
    fakeStudent(2, { grade: 'رابع', section: 'أ' }),
    fakeStudent(3, { grade: 'رابع', section: 'ب' }),
  ];

  it('resolves grade / section / custom / all', () => {
    expect(resolveTargets({ targetType: 'section', targetGrade: 'رابع', targetSection: 'أ' }, students).map(s => s.id)).toEqual(['1000000001', '1000000002']);
    expect(resolveTargets({ targetType: 'custom', targetStudentIds: ['1000000003'] }, students).map(s => s.id)).toEqual(['1000000003']);
    expect(resolveTargets({ targetType: 'all' }, students)).toHaveLength(3);
    expect(resolveTargets({ targetType: 'custom', targetStudentIds: [] }, students)).toHaveLength(0);
  });

  it('drops already-sent (non-failed) phones and caps the run', () => {
    const items = [
      { studentId: '1000000001', phone: '0590000001' },
      { studentId: '1000000002', phone: '0590000002' },
      { studentId: '1000000003', phone: '0590000003' },
    ];
    const sent = alreadySentKeys([
      { campaignId: 'C1', studentId: '1000000001', phone: '0590000001', status: 'sent' },
      { campaignId: 'C1', studentId: '1000000002', phone: '0590000002', status: 'failed' },
    ], 'C1');
    expect(sent.has(dispatchKey('1000000001', '0590000001'))).toBe(true);
    const left = remainingItems(items, sent);
    expect(left.map(i => i.studentId)).toEqual(['1000000002', '1000000003']);
    expect(sliceForRun(left, 1).map(i => i.studentId)).toEqual(['1000000002']);
  });
});

describe('enable typo-confirm', () => {
  it('accepts only the exact Arabic word', () => {
    expect(typedEnableMatches(TYPED_ENABLE_WORD)).toBe(true);
    expect(typedEnableMatches(' تفعيل ')).toBe(true);
    expect(typedEnableMatches('تفعيل.')).toBe(false);
    expect(typedEnableMatches('enable')).toBe(false);
    expect(typedEnableMatches('')).toBe(false);
  });
});
