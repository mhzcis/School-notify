/**
 * Cloud data backup export / restore.
 *
 * A backup is a JSON snapshot of the signed-in account's cloud data (students, templates,
 * scheduled campaigns, message logs, named recipient groups) plus non-secret UI prefs
 * (school name, send-mode, segment price, batch delay). Restore MERGES the file into the
 * cloud via the repository (upsert by national id / record id) — it never deletes existing
 * cloud records. Legacy v1 files (raw browser localStorage dumps) are rejected.
 *
 * Moodle credentials, student notes, and SMSGate server secrets are never written into the
 * file and are never re-imported from an older file that still contained them.
 */
import * as XLSX from 'xlsx';
import { AppData, SchoolRepository } from './repo/types';
import { FORBIDDEN_STUDENT_KEYS, isUuid, newId, stripForbiddenStudentFields } from './repo/mapping';
import { applyBackupPrefs, collectBackupPrefs, markBackupDownloaded, type BackupPrefs } from './smsPrefs';
import { parseGroups } from './recipientGroups';
import { parseSectionEvents } from './sectionEvents';
import { parseSuppressedList } from './suppression';
import { MessageLog, MessageTemplate, ScheduledMessage, Student } from '../types';

export const BACKUP_FORMAT = 'school-notify-cloud-backup';
export const BACKUP_FORMAT_VERSION = 2;
export const LEGACY_BACKUP_FORMAT = 'school-notify-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  /** Always false: secrets are never included in a backup file. Kept for compatibility with older readers. */
  secretsIncluded: false;
  data: AppData;
  prefs?: BackupPrefs;
}

export interface BackupSummary {
  students: number;
  templates: number;
  campaigns: number;
  logs: number;
  groups: number;
  sectionEvents: number;
  suppressed: number;
  hasPrefs: boolean;
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

/** Student fields that must never appear in a backup or student Excel export. */
export const STUDENT_SECRET_FIELDS = FORBIDDEN_STUDENT_KEYS;

export function sanitizeStudentsForBackup(students: Student[]): Student[] {
  return students.map(s => {
    const copy = stripForbiddenStudentFields({ ...s } as Student & Record<string, unknown>) as Student;
    for (const f of STUDENT_SECRET_FIELDS) delete (copy as any)[f];
    return copy;
  });
}

export function createBackup(data: AppData, opts: { now?: Date; prefs?: BackupPrefs } = {}): BackupFile {
  const prefs = opts.prefs ?? collectBackupPrefs();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    secretsIncluded: false,
    prefs: { ...prefs },
    data: {
      students: sanitizeStudentsForBackup(data.students),
      templates: data.templates,
      campaigns: data.campaigns,
      logs: data.logs,
      groups: parseGroups(data.groups ?? []),
      sectionEvents: parseSectionEvents(data.sectionEvents ?? []),
      suppressed: parseSuppressedList(data.suppressed ?? []),
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
  if (d.groups !== undefined && !Array.isArray(d.groups)) errors.push('الحقل "groups" ليس قائمة.');
  if (d.sectionEvents !== undefined && !Array.isArray(d.sectionEvents)) errors.push('الحقل "sectionEvents" ليس قائمة.');
  if (d.credentials !== undefined || d.moodleCredentials !== undefined) errors.push('ملف النسخة يحتوي بيانات دخول مودل وهذا غير مسموح.');
  if (parsed.prefs !== undefined && !isObj(parsed.prefs)) errors.push('حقل الإعدادات غير صالح.');
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

  const groups = parseGroups(d.groups ?? []);
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: parsed.version,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
    secretsIncluded: false,
    prefs: isObj(parsed.prefs) ? (parsed.prefs as BackupPrefs) : undefined,
    data: {
      students: sanitizeStudentsForBackup(d.students as Student[]),
      templates: d.templates as MessageTemplate[],
      campaigns: d.campaigns as ScheduledMessage[],
      logs: d.logs as MessageLog[],
      groups,
      sectionEvents: parseSectionEvents(d.sectionEvents ?? []),
      suppressed: parseSuppressedList(d.suppressed ?? []),
    },
  };
  return {
    ok: true,
    backup,
    summary: {
      students: d.students.length,
      templates: d.templates.length,
      campaigns: d.campaigns.length,
      logs: d.logs.length,
      groups: groups.length,
      sectionEvents: backup.data.sectionEvents?.length ?? 0,
      suppressed: backup.data.suppressed?.length ?? 0,
      hasPrefs: !!backup.prefs,
      secretsIncluded: false,
      exportedAt: backup.exportedAt,
    },
  };
}

/**
 * Merges a validated backup into the cloud. Existing records with the same national id / id are
 * updated; nothing is deleted. Template/campaign ids that are not UUIDs get fresh ids.
 * Incoming notes / Moodle credentials are stripped; any already stored in the cloud are kept.
 * Non-secret prefs are written to localStorage.
 */
export async function applyBackup(
  backup: BackupFile,
  repo: SchoolRepository,
  _currentStudents: Student[] = [],
  onProgress?: (stage: string) => void
): Promise<void> {
  const d = backup.data;
  const students = sanitizeStudentsForBackup(d.students as Student[]);
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
  const groups = parseGroups(d.groups ?? []);
  if (groups.length) {
    onProgress?.('groups');
    await repo.upsertRecipientGroups(groups);
  }
  const sectionEvents = parseSectionEvents(d.sectionEvents ?? []);
  if (sectionEvents.length) {
    onProgress?.('sectionEvents');
    await repo.upsertSectionEvents(sectionEvents);
  }
  const suppressed = parseSuppressedList(d.suppressed ?? []);
  if (suppressed.length) {
    onProgress?.('suppressed');
    const current = await repo.listSuppressedPhones();
    if (current.available) {
      const have = new Set(current.rows.map(r => r.phone));
      for (const s of suppressed) if (!have.has(s.phone)) await repo.upsertSuppressedPhone(s);
    }
  }
  if (backup.prefs) applyBackupPrefs(backup.prefs);
}

/** Excel workbook of the students (notes and credentials are never included). */
export function studentsWorkbook(students: Student[]): XLSX.WorkBook {
  const rows = sanitizeStudentsForBackup(students).map(s => ({
    'رقم الهوية': s.id,
    'اسم الطالب': s.name,
    'اسم الطالب بالإنجليزية': s.nameEn ?? '',
    'اسم ولي الأمر': s.parentName ?? '',
    'رقم الهاتف': s.phone ?? '',
    'رقم الهاتف 2': s.phone2 ?? '',
    'الصف': s.grade ?? '',
    'الشعبة': s.section ?? '',
    'البريد الإلكتروني': s.email ?? '',
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

/** Downloads a JSON backup of the current data and records the reminder timestamp. */
export function downloadDataBackup(data: AppData, opts: { label?: string; prefs?: BackupPrefs; now?: Date } = {}): BackupFile {
  const backup = createBackup(data, { prefs: opts.prefs, now: opts.now });
  downloadJson(backup, backupFilename(opts.now ?? new Date(), opts.label ?? 'backup'));
  markBackupDownloaded(opts.now ?? new Date());
  return backup;
}

/** True if a JSON string appears to contain Moodle credentials or SMSGate secrets. */
export function backupTextLooksSensitive(text: string): boolean {
  return /moodlePassword"\s*:\s*"[^"]+"|moodle_password"\s*:\s*"[^"]+"|كلمة_مرور_مودل|SMSGATE_|smsgate password|webhook.signing|encryption.passphrase/i.test(text);
}
