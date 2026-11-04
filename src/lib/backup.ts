/**
 * Full data backup export / restore for all `resal_*` localStorage keys.
 *
 * Values are stored as the exact raw strings found in localStorage so a restore
 * reproduces the original data byte-for-byte (no format changes).
 */
import { ARRAY_KEYS, CREDENTIAL_KEYS, STORAGE_PREFIX, STORAGE_KEYS, listAppKeys } from './storageKeys';

export const BACKUP_FORMAT = 'school-notify-backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  origin?: string;
  credentialsIncluded: boolean;
  data: Record<string, string>;
}

export interface BackupSummary {
  keys: string[];
  students: number;
  templates: number;
  scheduled: number;
  logs: number;
  credentialsIncluded: boolean;
  exportedAt: string;
}

export type ValidationResult =
  | { ok: true; backup: BackupFile; summary: BackupSummary }
  | { ok: false; errors: string[] };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** e.g. school-notify-backup-2026-11-04-1530.json */
export function backupFilename(date: Date = new Date(), label = 'backup'): string {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `school-notify-${label}-${stamp}.json`;
}

/** Student fields treated as secrets (Moodle default password). */
export const STUDENT_SECRET_FIELDS = ['moodlePassword'];

/** Blanks secret fields inside the students array value. */
function stripStudentSecrets(raw: string): string {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return raw;
    return JSON.stringify(
      arr.map((s: any) => {
        if (!s || typeof s !== 'object') return s;
        const copy = { ...s };
        for (const f of STUDENT_SECRET_FIELDS) if (f in copy) copy[f] = '';
        return copy;
      })
    );
  } catch {
    return raw;
  }
}

/** Removes credential fields (username/password/token) from the gateway config value. */
function stripCredentials(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return raw;
    const copy: Record<string, unknown> = { ...obj };
    for (const k of Object.keys(copy)) {
      if (/password|token|secret|username|apikey|api_key/i.test(k)) {
        copy[k] = '';
      }
    }
    return JSON.stringify(copy);
  } catch {
    return raw;
  }
}

export function createBackup(
  storage: Storage = localStorage,
  options: { includeCredentials?: boolean; now?: Date; origin?: string } = {}
): BackupFile {
  // Secrets (gateway credentials, Moodle passwords) are EXCLUDED unless explicitly requested.
  const includeCredentials = options.includeCredentials ?? false;
  const data: Record<string, string> = {};
  for (const key of listAppKeys(storage)) {
    const value = storage.getItem(key);
    if (value === null) continue;
    if (includeCredentials) data[key] = value;
    else if (CREDENTIAL_KEYS.includes(key)) data[key] = stripCredentials(value);
    else if (key === STORAGE_KEYS.students) data[key] = stripStudentSecrets(value);
    else data[key] = value;
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: (options.now ?? new Date()).toISOString(),
    origin: options.origin,
    credentialsIncluded: includeCredentials,
    data,
  };
}

function countArray(raw: string | undefined): number {
  if (raw === undefined) return 0;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

/** Validates an uploaded backup file (as text). Never touches storage. */
export function validateBackup(text: string): ValidationResult {
  const errors: string[] = [];
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['الملف ليس بصيغة JSON صالحة.'] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['بنية الملف غير صحيحة.'] };
  }
  if (parsed.format !== BACKUP_FORMAT) errors.push('هذا الملف ليس نسخة احتياطية لتطبيق School Notify.');
  if (typeof parsed.version !== 'number' || parsed.version < 1) {
    errors.push('رقم إصدار النسخة الاحتياطية مفقود أو غير صالح.');
  } else if (parsed.version > BACKUP_FORMAT_VERSION) {
    errors.push('النسخة الاحتياطية صادرة من إصدار أحدث من التطبيق ولا يمكن استعادتها هنا.');
  }
  if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    errors.push('لا توجد بيانات داخل النسخة الاحتياطية.');
  }
  if (errors.length) return { ok: false, errors };

  const data: Record<string, unknown> = parsed.data;
  const keys = Object.keys(data);
  if (keys.length === 0) errors.push('النسخة الاحتياطية فارغة.');
  for (const key of keys) {
    if (!key.startsWith(STORAGE_PREFIX)) {
      errors.push(`مفتاح غير معروف: ${key}`);
      continue;
    }
    const value = data[key];
    if (typeof value !== 'string') {
      errors.push(`قيمة غير صالحة للمفتاح ${key}`);
      continue;
    }
    if (ARRAY_KEYS.includes(key)) {
      try {
        const arr = JSON.parse(value);
        if (!Array.isArray(arr)) errors.push(`المفتاح ${key} يجب أن يكون قائمة.`);
        else if (key === STORAGE_KEYS.students) {
          const bad = arr.filter((s: any) => !s || typeof s !== 'object' || typeof s.id !== 'string' || typeof s.name !== 'string');
          if (bad.length) errors.push(`يوجد (${bad.length}) سجل طالب بدون معرف أو اسم.`);
        }
      } catch {
        errors.push(`المفتاح ${key} يحتوي JSON تالف.`);
      }
    }
  }
  if (errors.length) return { ok: false, errors };

  const backup = parsed as BackupFile;
  return {
    ok: true,
    backup,
    summary: {
      keys,
      students: countArray(backup.data[STORAGE_KEYS.students]),
      templates: countArray(backup.data[STORAGE_KEYS.templates]),
      scheduled: countArray(backup.data[STORAGE_KEYS.scheduled]),
      logs: countArray(backup.data[STORAGE_KEYS.logs]),
      credentialsIncluded: !!backup.credentialsIncluded,
      exportedAt: String(backup.exportedAt ?? ''),
    },
  };
}

/**
 * Writes a validated backup into storage. Keys present in the backup replace the
 * current values; other existing keys are left untouched (nothing is deleted).
 * Callers MUST download a pre-restore backup first (see BackupPanel).
 */
export function applyBackup(backup: BackupFile, storage: Storage = localStorage): string[] {
  const written: string[] = [];
  for (const [key, value] of Object.entries(backup.data)) {
    if (!key.startsWith(STORAGE_PREFIX) || typeof value !== 'string') continue;
    storage.setItem(key, value);
    written.push(key);
  }
  return written;
}

/** Triggers a browser download of a JSON object. */
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
