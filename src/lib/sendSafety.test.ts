import { describe, expect, it } from 'vitest';
import {
  LARGE_SEND_THRESHOLD,
  duplicateWarningCount,
  findDuplicateSends,
  isQuietHours,
  requiresTypedCount,
  typedCountMatches,
} from './sendSafety';
import type { MessageLog } from '../types';

const fakeLog = (over: Partial<MessageLog> = {}): MessageLog => ({
  id: 'L1',
  studentId: '1000000001',
  studentName: 'طالب تجريبي',
  parentName: 'ولي أمر تجريبي',
  phone: '0590000001',
  grade: 'العاشر',
  section: 'أ',
  messageContent: 'نص تجريبي',
  sentTime: '2026-11-18T12:00:00.000Z',
  status: 'sent',
  ...over,
});

describe('typed count', () => {
  it('requires typing the count at the default threshold of 30', () => {
    expect(requiresTypedCount(29)).toBe(false);
    expect(requiresTypedCount(30)).toBe(true);
    expect(requiresTypedCount(31)).toBe(true);
    expect(LARGE_SEND_THRESHOLD).toBe(30);
    expect(typedCountMatches('30', 30)).toBe(true);
    expect(typedCountMatches(' 30 ', 30)).toBe(true);
    expect(typedCountMatches('29', 30)).toBe(false);
    expect(typedCountMatches('30.0', 30)).toBe(false);
    expect(typedCountMatches('', 30)).toBe(false);
  });
});

describe('quiet hours (Asia/Jerusalem)', () => {
  // Winter 2026: Asia/Jerusalem is UTC+2.
  it('is active from 22:00 inclusive to 07:00 exclusive', () => {
    expect(isQuietHours(new Date('2026-11-18T19:59:00.000Z'))).toBe(false); // 21:59
    expect(isQuietHours(new Date('2026-11-18T20:00:00.000Z'))).toBe(true); // 22:00
    expect(isQuietHours(new Date('2026-11-18T23:30:00.000Z'))).toBe(true); // 01:30
    expect(isQuietHours(new Date('2026-11-18T04:59:00.000Z'))).toBe(true); // 06:59
    expect(isQuietHours(new Date('2026-11-18T05:00:00.000Z'))).toBe(false); // 07:00
    expect(isQuietHours(new Date('2026-11-18T12:00:00.000Z'))).toBe(false); // 14:00
  });
});

describe('24h duplicate warning', () => {
  const now = new Date('2026-11-18T15:00:00.000Z');
  const items = [{ phone: '0590000001', content: 'نص تجريبي' }];

  it('warns only on the same normalised phone and the same body within 24h', () => {
    const hits = findDuplicateSends(items, [fakeLog({ sentTime: '2026-11-18T14:00:00.000Z' })], now);
    expect(hits).toEqual([{ phone: '0590000001', count: 1 }]);
    expect(duplicateWarningCount(hits)).toBe(1);
  });

  it('treats +970 / leading-zero variants as the same phone', () => {
    const hits = findDuplicateSends(
      [{ phone: '+970590000001', content: 'نص تجريبي' }],
      [fakeLog({ phone: '0590000001', sentTime: '2026-11-18T14:00:00.000Z' })],
      now
    );
    expect(hits).toHaveLength(1);
  });

  it('does not warn for a different body, a failed log, or a send older than 24h', () => {
    expect(findDuplicateSends(items, [fakeLog({ messageContent: 'نص آخر' })], now)).toEqual([]);
    expect(findDuplicateSends(items, [fakeLog({ status: 'failed' })], now)).toEqual([]);
    expect(findDuplicateSends(items, [fakeLog({ sentTime: '2026-11-16T15:00:00.000Z' })], now)).toEqual([]);
    expect(findDuplicateSends([{ phone: '0590000002', content: 'نص تجريبي' }], [fakeLog()], now)).toEqual([]);
  });
});
