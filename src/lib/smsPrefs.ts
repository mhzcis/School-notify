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
 */
export const UI_PREF_KEYS = {
  schoolName: 'sn_school_name',
  phonePrefix: 'sn_phone_prefix',
  smsSegmentPrice: 'sn_sms_segment_price',
  smsBatchDelaySec: 'sn_sms_batch_delay_sec',
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
