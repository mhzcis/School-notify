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
