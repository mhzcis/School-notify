/**
 * Report / dashboard totals: test and archived campaigns are excluded by default.
 */
import type { MessageLog } from '../types';
import type { CampaignFlags } from './repo/mapping';
import { summarizeLogs, LogSummary } from './logStatus';

export interface StatsFilter {
  /** When true, test and archived campaigns are included. Default false. */
  includeTest?: boolean;
}

export function flagsByCampaignId(flags: CampaignFlags[] | undefined | null): Map<string, CampaignFlags> {
  const map = new Map<string, CampaignFlags>();
  for (const f of flags ?? []) map.set(f.id, f);
  return map;
}

export function isTestOrArchivedLog(log: MessageLog, flags: Map<string, CampaignFlags>): boolean {
  if (log.isTest) return true;
  if (!log.campaignId) return false;
  const f = flags.get(log.campaignId);
  return Boolean(f?.isTest || f?.archived);
}

export function filterLogsForStats(logs: MessageLog[], flags: CampaignFlags[] | undefined, opts: StatsFilter = {}): MessageLog[] {
  if (opts.includeTest) return logs;
  const map = flagsByCampaignId(flags);
  return logs.filter(l => !isTestOrArchivedLog(l, map));
}

export function summarizeLogsForStats(logs: MessageLog[], flags: CampaignFlags[] | undefined, opts: StatsFilter = {}): LogSummary {
  return summarizeLogs(filterLogsForStats(logs, flags, opts));
}

/** Unique student ids from failed logs (first-seen order). */
export function failedStudentIds(logs: MessageLog[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of logs) {
    if (l.status !== 'failed') continue;
    const id = String(l.studentId || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function contentTemplateFromFailed(logs: MessageLog[]): string {
  const failed = logs.filter(l => l.status === 'failed');
  const withTpl = failed.find(l => l.contentTemplate);
  return withTpl?.contentTemplate || '';
}
