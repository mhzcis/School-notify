/** Non-sensitive UI preference: whether "send" uses the cloud SMS gateway or the manual WhatsApp/SMS queue. */
const KEY = 'sn_use_cloud_gateway';

export function readUseCloudGateway(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeUseCloudGateway(v: boolean): void {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* ignore */
  }
}

/**
 * Other non-sensitive UI preferences. They use the `sn_` prefix so that the old browser-only
 * `resal_*` keys are never read (and never deleted) by the cloud version of the app.
 *
 * Never store SMSGate credentials or Moodle passwords in these keys (those live in server
 * secrets / a later Phase 3 owner-only table).
 */
export const UI_PREF_KEYS = {
  schoolName: 'sn_school_name',
  phonePrefix: 'sn_phone_prefix',
  smsSegmentPrice: 'sn_sms_segment_price',
  smsBatchDelaySec: 'sn_sms_batch_delay_sec',
  lastBackupAt: 'sn_last_backup_at',
  lastFilterCompose: 'sn_last_filter_compose',
  lastFilterDashboard: 'sn_last_filter_dashboard',
  theme: 'sn_theme',
} as const;

export function readPref(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Seconds to wait between gateway batches (0–300, default 2). */
export function readBatchDelaySec(): number {
  const n = Number(readPref(UI_PREF_KEYS.smsBatchDelaySec, '2'));
  return Number.isFinite(n) ? Math.min(300, Math.max(0, Math.round(n))) : 2;
}

export function writeBatchDelaySec(sec: number): void {
  const n = Number.isFinite(sec) ? Math.min(300, Math.max(0, Math.round(sec))) : 2;
  writePref(UI_PREF_KEYS.smsBatchDelaySec, String(n));
}

/** Non-secret prefs included in a v2 backup (and restored after a browser wipe). */
export interface BackupPrefs {
  schoolName?: string;
  phonePrefix?: string;
  smsSegmentPrice?: string;
  smsBatchDelaySec?: string;
  useCloudGateway?: boolean;
  lastFilterCompose?: string;
  lastFilterDashboard?: string;
  theme?: string;
}

export function collectBackupPrefs(): BackupPrefs {
  return {
    schoolName: readPref(UI_PREF_KEYS.schoolName),
    phonePrefix: readPref(UI_PREF_KEYS.phonePrefix),
    smsSegmentPrice: readPref(UI_PREF_KEYS.smsSegmentPrice),
    smsBatchDelaySec: readPref(UI_PREF_KEYS.smsBatchDelaySec),
    useCloudGateway: readUseCloudGateway(),
    lastFilterCompose: readPref(UI_PREF_KEYS.lastFilterCompose),
    lastFilterDashboard: readPref(UI_PREF_KEYS.lastFilterDashboard),
    theme: readPref(UI_PREF_KEYS.theme),
  };
}

/** Applies non-secret prefs from a backup. Missing keys are left unchanged. */
export function applyBackupPrefs(prefs: BackupPrefs | undefined | null): void {
  if (!prefs || typeof prefs !== 'object') return;
  if (typeof prefs.schoolName === 'string') writePref(UI_PREF_KEYS.schoolName, prefs.schoolName);
  if (typeof prefs.phonePrefix === 'string') writePref(UI_PREF_KEYS.phonePrefix, prefs.phonePrefix);
  if (typeof prefs.smsSegmentPrice === 'string') writePref(UI_PREF_KEYS.smsSegmentPrice, prefs.smsSegmentPrice);
  if (typeof prefs.smsBatchDelaySec === 'string') writePref(UI_PREF_KEYS.smsBatchDelaySec, prefs.smsBatchDelaySec);
  if (typeof prefs.useCloudGateway === 'boolean') writeUseCloudGateway(prefs.useCloudGateway);
  if (typeof prefs.lastFilterCompose === 'string' && prefs.lastFilterCompose) writePref(UI_PREF_KEYS.lastFilterCompose, prefs.lastFilterCompose.slice(0, 1000));
  if (typeof prefs.lastFilterDashboard === 'string' && prefs.lastFilterDashboard) writePref(UI_PREF_KEYS.lastFilterDashboard, prefs.lastFilterDashboard.slice(0, 1000));
  if (prefs.theme === 'light' || prefs.theme === 'dark' || prefs.theme === 'system') writePref(UI_PREF_KEYS.theme, prefs.theme);
}

export const BACKUP_REMINDER_DAYS = 7;

export function markBackupDownloaded(now: Date = new Date()): void {
  writePref(UI_PREF_KEYS.lastBackupAt, now.toISOString());
}

export function lastBackupAt(): Date | null {
  const raw = readPref(UI_PREF_KEYS.lastBackupAt);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Days since the last downloaded backup, or null if none was recorded. */
export function daysSinceLastBackup(now: Date = new Date()): number | null {
  const last = lastBackupAt();
  if (!last) return null;
  return Math.floor((now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000));
}

/** True when no backup was downloaded, or the last one is older than `days`. */
export function isBackupReminderDue(now: Date = new Date(), days: number = BACKUP_REMINDER_DAYS): boolean {
  const last = lastBackupAt();
  if (!last) return true;
  return now.getTime() - last.getTime() >= days * 24 * 60 * 60 * 1000;
}
