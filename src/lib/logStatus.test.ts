import { describe, expect, it } from 'vitest';
import { STATUS_LABELS, statusAfterGatewayCall, summarizeLogs } from './logStatus';
import type { MessageLog } from '../types';

const log = (status: MessageLog['status']): MessageLog => ({
  id: 'L' + Math.random(), studentId: 'S1', studentName: 'طالب تجريبي', parentName: 'ولي أمر تجريبي',
  phone: '0599000001', grade: 'الأول', section: 'أ', messageContent: 'نص تجريبي', sentTime: '2026-01-01T08:00:00Z', status,
});

describe('logStatus', () => {
  it('a successful gateway call is "sent", never "delivered"', () => {
    expect(statusAfterGatewayCall(true)).toBe('sent');
    expect(statusAfterGatewayCall(false)).toBe('failed');
  });

  it('summarizes honestly: sent is not counted as failed', () => {
    const s = summarizeLogs([log('sent'), log('sent'), log('delivered'), log('failed'), log('pending')]);
    expect(s).toEqual({ total: 5, pending: 1, sent: 2, delivered: 1, failed: 1, successful: 3, successRate: 75 });
  });

  it('no attempts => null rate (not a fake 100%)', () => {
    expect(summarizeLogs([]).successRate).toBeNull();
    expect(summarizeLogs([log('pending')]).successRate).toBeNull();
  });

  it('labels do not claim delivery for sent', () => {
    expect(STATUS_LABELS.sent).not.toContain('استلام للهاتف');
    expect(STATUS_LABELS.sent).toContain('بدون تأكيد');
  });
});
