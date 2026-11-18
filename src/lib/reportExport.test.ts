import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { MessageLog } from '../types';
import { filterLogsForStats } from './reportStats';
import { SECRET_MASK } from './template';
import { buildReportsWorkbook, reportByCampaignRows, reportDetailRows, REPORT_BY_CAMPAIGN_SHEET, REPORT_DETAIL_SHEET, REPORT_TOTALS_SHEET } from './reportExport';

const fakeLog = (n: number, extra: Partial<MessageLog> = {}): MessageLog => ({
  id: `11111111-1111-4111-8111-11111111111${n}`,
  campaignId: extra.campaignId ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  studentId: String(1000000000 + n),
  studentName: `طالب تجريبي ${n}`,
  parentName: 'ولي أمر تجريبي',
  phone: `05900000${String(n).padStart(2, '0')}`,
  grade: 'العاشر',
  section: n === 1 ? 'أ' : 'ب',
  messageContent: extra.messageContent ?? `رسالة تجريبية ${n}`,
  sentTime: `2026-11-18T08:0${n}:00.000Z`,
  status: extra.status ?? 'delivered',
  ...extra,
});

const CAMPAIGN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CAMPAIGN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const titles = { [CAMPAIGN_A]: 'حملة رسوم تجريبية', [CAMPAIGN_B]: 'حملة حضور تجريبية' };

describe('report Excel export', () => {
  const logs: MessageLog[] = [
    fakeLog(1, { campaignId: CAMPAIGN_A, status: 'delivered', messageContent: `مرحبا ${SECRET_MASK}` }),
    fakeLog(2, { campaignId: CAMPAIGN_A, status: 'failed', failureReason: 'الهاتف مغلق' }),
    fakeLog(3, { campaignId: CAMPAIGN_B, status: 'sent' }),
    fakeLog(4, { campaignId: CAMPAIGN_B, status: 'delivered', isTest: true, messageContent: 'تجريبي' }),
  ];

  it('detail rows include the expected columns, campaign titles, segment counts and masked body', () => {
    const visible = filterLogsForStats(logs, [], { includeTest: false });
    const rows = reportDetailRows(visible, { campaignTitles: titles });
    expect(rows).toHaveLength(3); // test log excluded
    expect(rows[0]['عنوان الحملة']).toBe('حملة رسوم تجريبية');
    expect(rows[0]['الصف']).toBe('العاشر');
    expect(rows[0]['الشعبة']).toBe('أ');
    expect(rows[0]['الهاتف']).toBe('0590000001');
    expect(rows[0]['عدد المقاطع']).toBeGreaterThanOrEqual(1);
    expect(rows[0]['نص الرسالة']).toContain(SECRET_MASK);
    expect(rows[1]['سبب الفشل']).toBe('الهاتف مغلق');
    expect(rows[2]['عنوان الحملة']).toBe('حملة حضور تجريبية');
    const keys = Object.keys(rows[0]);
    expect(keys).toEqual([
      'الوقت', 'عنوان الحملة', 'الصف', 'الشعبة', 'الحالة', 'سبب الفشل', 'عدد المقاطع', 'نص الرسالة', 'الهاتف', 'اسم الطالب',
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/moodlePassword|كلمة مرور مودل/i);
  });

  it('honours an additional status filter and writes per-campaign totals on separate sheets', () => {
    const visible = filterLogsForStats(logs, [], { includeTest: false }).filter(l => l.status === 'failed');
    const wb = buildReportsWorkbook(visible, { campaignTitles: titles });
    expect(wb.SheetNames).toEqual([REPORT_DETAIL_SHEET, REPORT_TOTALS_SHEET, REPORT_BY_CAMPAIGN_SHEET]);
    const details = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[REPORT_DETAIL_SHEET]);
    expect(details).toHaveLength(1);
    expect(details[0]['الحالة']).toContain('فشل');
    const byCamp = reportByCampaignRows(filterLogsForStats(logs, [], { includeTest: false }), { campaignTitles: titles });
    expect(byCamp).toHaveLength(2);
    expect(byCamp[0]['عنوان الحملة']).toBe('حملة رسوم تجريبية');
    expect(byCamp[0]['عدد الرسائل']).toBe(2);
    expect(byCamp[0]['فشل الإرسال']).toBe(1);
    expect(byCamp[1]['أُرسلت']).toBe(1);
    const totals = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[REPORT_TOTALS_SHEET]);
    expect(totals.find(r => r['البند'] === 'عدد الرسائل')!['القيمة']).toBe(1);
  });
});
