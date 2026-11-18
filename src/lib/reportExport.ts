/**
 * Excel export of delivery reports.
 * The caller passes already-filtered logs (status / campaign / test-exclusion).
 * Message bodies are exported as stored (the app masks secrets before persisting logs).
 * Moodle credentials are never added to the sheet.
 */
import * as XLSX from 'xlsx';
import type { MessageLog } from '../types';
import { STATUS_LABELS, summarizeLogs } from './logStatus';
import { segmentInfo } from './sms';
import { SECRET_MASK } from './template';

export interface ReportExportOptions {
  campaignTitles?: Record<string, string>;
  /** Fallback title when a log has no campaign id / unknown id. */
  unknownCampaignTitle?: string;
}

export const REPORT_DETAIL_SHEET = 'التفاصيل';
export const REPORT_TOTALS_SHEET = 'الإجماليات';
export const REPORT_BY_CAMPAIGN_SHEET = 'حسب الحملة';

export function campaignTitleForLog(log: MessageLog, titles: Record<string, string> = {}, fallback = 'إرسال فوري'): string {
  const id = String(log.campaignId ?? '').trim();
  if (id && titles[id]) return titles[id];
  return fallback;
}

function maskBody(body: string): string {
  const text = body ?? '';
  // Stored logs should already be masked; keep any obvious leftover password placeholders covered.
  return text.replace(/{{\s*كلمة_المرور(?:_مودل)?\s*}}/g, SECRET_MASK);
}

export interface ReportExportRow {
  'الوقت': string;
  'عنوان الحملة': string;
  'الصف': string;
  'الشعبة': string;
  'الحالة': string;
  'سبب الفشل': string;
  'عدد المقاطع': number;
  'نص الرسالة': string;
  'الهاتف': string;
  'اسم الطالب': string;
}

export function reportDetailRows(logs: MessageLog[], opts: ReportExportOptions = {}): ReportExportRow[] {
  const titles = opts.campaignTitles ?? {};
  const fallback = opts.unknownCampaignTitle ?? 'إرسال فوري';
  return logs.map(l => ({
    'الوقت': l.sentTime ?? '',
    'عنوان الحملة': campaignTitleForLog(l, titles, fallback),
    'الصف': l.grade ?? '',
    'الشعبة': l.section ?? '',
    'الحالة': STATUS_LABELS[l.status] ?? l.status,
    'سبب الفشل': l.status === 'failed' ? (l.failureReason ?? '') : '',
    'عدد المقاطع': segmentInfo(l.messageContent ?? '').segments,
    'نص الرسالة': maskBody(l.messageContent ?? ''),
    'الهاتف': l.phone ?? '',
    'اسم الطالب': l.studentName ?? '',
  }));
}

export function reportTotalsRows(logs: MessageLog[]): Array<Record<string, string | number>> {
  const summary = summarizeLogs(logs);
  const totalSegments = logs.reduce((n, l) => n + segmentInfo(l.messageContent ?? '').segments, 0);
  return [
    { 'البند': 'عدد الرسائل', 'القيمة': summary.total },
    { 'البند': 'بانتظار الإرسال', 'القيمة': summary.pending },
    { 'البند': 'أُرسلت (بدون تأكيد استلام)', 'القيمة': summary.sent },
    { 'البند': 'تم تأكيد الاستلام', 'القيمة': summary.delivered },
    { 'البند': 'فشل الإرسال', 'القيمة': summary.failed },
    { 'البند': 'إجمالي المقاطع', 'القيمة': totalSegments },
  ];
}

export function reportByCampaignRows(logs: MessageLog[], opts: ReportExportOptions = {}): Array<Record<string, string | number>> {
  const titles = opts.campaignTitles ?? {};
  const fallback = opts.unknownCampaignTitle ?? 'إرسال فوري';
  const order: string[] = [];
  const groups = new Map<string, MessageLog[]>();
  for (const l of logs) {
    const key = String(l.campaignId ?? '').trim() || '__none__';
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(l);
  }
  return order.map(key => {
    const list = groups.get(key)!;
    const summary = summarizeLogs(list);
    const title = key === '__none__' ? fallback : (titles[key] || fallback);
    const totalSegments = list.reduce((n, l) => n + segmentInfo(l.messageContent ?? '').segments, 0);
    return {
      'عنوان الحملة': title,
      'عدد الرسائل': summary.total,
      'بانتظار الإرسال': summary.pending,
      'أُرسلت': summary.sent,
      'تم التسليم': summary.delivered,
      'فشل الإرسال': summary.failed,
      'إجمالي المقاطع': totalSegments,
    };
  });
}

export function buildReportsWorkbook(logs: MessageLog[], opts: ReportExportOptions = {}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reportDetailRows(logs, opts)), REPORT_DETAIL_SHEET);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reportTotalsRows(logs)), REPORT_TOTALS_SHEET);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reportByCampaignRows(logs, opts)), REPORT_BY_CAMPAIGN_SHEET);
  return wb;
}
