/**
 * Central registry of the localStorage keys used by the app.
 * All app keys share the `resal_` prefix; existing key names and value formats
 * must never be changed (backwards compatibility with data already saved in browsers).
 */
export const STORAGE_PREFIX = 'resal_';

export const STORAGE_KEYS = {
  schoolName: 'resal_school_name',
  tempExcelMatchIds: 'resal_temp_excel_match_ids',
  students: 'resal_students',
  templates: 'resal_templates',
  scheduled: 'resal_scheduled',
  logs: 'resal_logs',
  useSilentGateway: 'resal_use_silent_gateway',
  silentGatewayConfig: 'resal_silent_gateway_config',
  phonePrefix: 'resal_phone_prefix',
  smsSegmentPrice: 'resal_sms_segment_price',
} as const;

/** Keys whose value is expected to be a JSON array. */
export const ARRAY_KEYS: string[] = [
  STORAGE_KEYS.students,
  STORAGE_KEYS.templates,
  STORAGE_KEYS.scheduled,
  STORAGE_KEYS.logs,
  STORAGE_KEYS.tempExcelMatchIds,
];

/** Keys that may contain gateway credentials (username/password/token). */
export const CREDENTIAL_KEYS: string[] = [STORAGE_KEYS.silentGatewayConfig];

/** Returns every localStorage key that belongs to the app (resal_* prefix). */
export function listAppKeys(storage: Storage = localStorage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
  }
  return keys.sort();
}
