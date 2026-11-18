import { describe, expect, it } from 'vitest';
import { contentTemplateFromFailed, failedStudentIds, filterLogsForStats, summarizeLogsForStats } from './reportStats';
import type { MessageLog } from '../types';

const log = (over: Partial<MessageLog>): MessageLog => ({
  id: 'L',
  studentId: '1000000001',
  studentName: 'طالب تجريبي',
  parentName: 'ولي أمر تجريبي',
  phone: '0590000001',
  grade: 'العاشر',
  section: 'أ',
  messageContent: 'نص',
  sentTime: '2026-11-18T12:00:00.000Z',
  status: 'sent',
  ...over,
});

describe('filterLogsForStats', () => {
  const logs: MessageLog[] = [
    log({ id: '1', status: 'delivered', campaignId: 'c-real' }),
    log({ id: '2', status: 'failed', campaignId: 'c-test', studentId: '1000000002', isTest: true, contentTemplate: 'قالب تجريبي' }),
    log({ id: '3', status: 'sent', campaignId: 'c-hidden' }),
    log({ id: '4', status: 'failed', campaignId: 'c-real', studentId: '1000000003' }),
  ];
  const flags = [
    { id: 'c-real', isTest: false, archived: false },
    { id: 'c-test', isTest: true, archived: false },
    { id: 'c-hidden', isTest: false, archived: true },
  ];

  it('excludes test and archived campaigns from default totals, and can include them with a toggle', () => {
    const def = filterLogsForStats(logs, flags);
    expect(def.map(l => l.id)).toEqual(['1', '4']);
    const all = filterLogsForStats(logs, flags, { includeTest: true });
    expect(all).toHaveLength(4);
    const summary = summarizeLogsForStats(logs, flags);
    expect(summary.delivered).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.total).toBe(2);
  });

  it('resend helpers return only failed student ids and the stored template', () => {
    expect(failedStudentIds(logs)).toEqual(['1000000002', '1000000003']);
    expect(contentTemplateFromFailed(logs)).toBe('قالب تجريبي');
  });
});
