/**
 * Cloud data backup export / restore.
 *
 * A backup is a JSON snapshot of the signed-in account's cloud data (students, templates,
 * scheduled campaigns, message logs). Restore MERGES the file into the cloud via the repository
 * (upsert by national id / record id) — it never deletes existing cloud records.
 * Legacy v1 files (raw browser localStorage dumps) are rejected: old local data is not migrated.
 */
import * as XLSX from 'xlsx';
import { AppData, SchoolRepository } from './repo/types';
import { isUuid, newId } from './repo/mapping';
import { MessageLog, MessageTemplate, ScheduledMessage, Student } from '../types';

export const BACKUP_FORMAT = 'school-notify-cloud-backup';
export const BACKUP_FORMAT_VERSION = 2;
export const LEGACY_BACKUP_FORMAT = 'school-notify-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  secretsIncluded: boolean;
  data: AppData;
}

export interface BackupSummary {
  students: number;
  templates: number;
  campaigns: number;
  logs: number;
  secretsIncluded: boolean;
  exportedAt: string;
}

export type ValidationResult =
  | { ok: true; backup: BackupFile; summary: BackupSummary }
  | { ok: false; errors: string[] };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** e.g. school-notify-backup-2026-11-04-1530.json */
export function backupFilename(date: Date = new Date(), label = 'backup', ext = 'json'): string {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `school-notify-${label}-${stamp}.${ext}`;
}

/** Student fields treated as secrets (Moodle default password). */
export const STUDENT_SECRET_FIELDS = ['moodlePassword'] as const;

export function stripStudentSecrets(students: Student[]): Student[] {
  return students.map(s => {
    const copy: any = { ...s };
    for (const f of STUDENT_SECRET_FIELDS) if (f in copy) copy[f] = '';
    return copy as Student;
  });
}

export function createBackup(data: AppData, opts: { includeSecrets?: boolean; now?: Date } = {}): BackupFile {
  const includeSecrets = !!opts.includeSecrets;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    secretsIncluded: includeSecrets,
    data: {
      students: includeSecrets ? data.students : stripStudentSecrets(data.students),
      templates: data.templates,
      campaigns: data.campaigns,
      logs: data.logs,
    },
  };
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validateBackup(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['الملف ليس JSON صالحاً.'] };
  }
  if (!isObj(parsed)) return { ok: false, errors: ['محتوى الملف غير صالح.'] };
  if (parsed.format === LEGACY_BACKUP_FORMAT) {
    return {
      ok: false,
      errors: ['هذه نسخة احتياطية قديمة من بيانات المتصفح المحلية (الإصدار 1). لا يتم ترحيل البيانات القديمة إلى السحابة.'],
    };
  }
  if (parsed.format !== BACKUP_FORMAT) return { ok: false, errors: ['هذا الملف ليس نسخة احتياطية من نظام الإشعارات.'] };
  if (typeof parsed.version !== 'number' || parsed.version > BACKUP_FORMAT_VERSION) {
    return { ok: false, errors: ['إصدار النسخة الاحتياطية غير مدعوم.'] };
  }
  const d = parsed.data;
  const errors: string[] = [];
  if (!isObj(d)) return { ok: false, errors: ['لا توجد بيانات داخل الملف.'] };
  for (const k of ['students', 'templates', 'campaigns', 'logs']) {
    if (!Array.isArray(d[k])) errors.push(`الحقل "${k}" مفقود أو ليس قائمة.`);
  }
  if (errors.length) return { ok: false, errors };
  const badStudents = (d.students as unknown[]).filter(s => !isObj(s) || !String((s as any).id ?? '').trim() || typeof (s as any).name !== 'string');
  if (badStudents.length) errors.push(`يوجد (${badStudents.length}) سجل طالب بدون رقم هوية أو اسم.`);
  const badTemplates = (d.templates as unknown[]).filter(t => !isObj(t) || typeof (t as any).content !== 'string');
  if (badTemplates.length) errors.push(`يوجد (${badTemplates.length}) قالب غير صالح.`);
  const badCampaigns = (d.campaigns as unknown[]).filter(c => !isObj(c) || typeof (c as any).contentTemplate !== 'string');
  if (badCampaigns.length) errors.push(`يوجد (${badCampaigns.length}) حملة غير صالحة.`);
  const badLogs = (d.logs as unknown[]).filter(l => !isObj(l) || typeof (l as any).messageContent !== 'string');
  if (badLogs.length) errors.push(`يوجد (${badLogs.length}) سجل إرسال غير صالح.`);
  if (errors.length) return { ok: false, errors };

  const backup = parsed as unknown as BackupFile;
  return {
    ok: true,
    backup,
    summary: {
      students: d.students.length,
      templates: d.templates.length,
      campaigns: d.campaigns.length,
      logs: d.logs.length,
      secretsIncluded: !!parsed.secretsIncluded,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
    },
  };
}

/**
 * Merges a validated backup into the cloud. Existing records with the same national id / id are
 * updated; nothing is deleted. Template/campaign ids that are not UUIDs get fresh ids.
 */
export async function applyBackup(
  backup: BackupFile,
  repo: SchoolRepository,
  currentStudents: Student[] = [],
  onProgress?: (stage: string) => void
): Promise<void> {
  const d = backup.data;
  let students = d.students as Student[];
  if (!backup.secretsIncluded) {
    // A backup without secrets must not wipe the Moodle passwords already stored in the cloud.
    const existing = new Map(currentStudents.map(s => [String(s.id).trim(), (s as any).moodlePassword]));
    students = students.map(s => {
      const pw = existing.get(String(s.id).trim());
      return pw && !(s as any).moodlePassword ? ({ ...s, moodlePassword: pw } as Student) : s;
    });
  }
  onProgress?.('students');
  await repo.upsertStudents(students);
  onProgress?.('templates');
  await repo.upsertTemplates((d.templates as MessageTemplate[]).map(t => (isUuid(t.id) ? t : { ...t, id: newId() })));
  const campaignIdMap = new Map<string, string>();
  const campaigns = (d.campaigns as ScheduledMessage[]).map(c => {
    if (isUuid(c.id)) return c;
    const id = newId();
    campaignIdMap.set(c.id, id);
    return { ...c, id };
  });
  onProgress?.('campaigns');
  await repo.upsertCampaigns(campaigns);
  onProgress?.('logs');
  const logs = (d.logs as MessageLog[]).map(l =>
    l.campaignId && campaignIdMap.has(l.campaignId) ? { ...l, campaignId: campaignIdMap.get(l.campaignId) } : l
  );
  await repo.addLogs(logs);
}

/** Excel workbook of the students (secrets blanked unless includeSecrets). */
export function studentsWorkbook(students: Student[], includeSecrets = false): XLSX.WorkBook {
  const rows = (includeSecrets ? students : stripStudentSecrets(students)).map(s => ({
    'رقم الهوية': s.id,
    'اسم الطالب': s.name,
    'اسم الطالب بالإنجليزية': s.nameEn ?? '',
    'اسم ولي الأمر': s.parentName ?? '',
    'رقم الهاتف': s.phone ?? '',
    'رقم الهاتف 2': s.phone2 ?? '',
    'الصف': s.grade ?? '',
    'الشعبة': s.section ?? '',
    'البريد الإلكتروني': s.email ?? '',
    ...(includeSecrets ? { 'كلمة مرور Moodle': (s as any).moodlePassword ?? '' } : {}),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'الطلاب');
  return wb;
}

export function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
