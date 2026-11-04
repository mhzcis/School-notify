/**
 * Safe localStorage access.
 * - Corrupt JSON (or a value of the wrong shape) is never silently overwritten: the raw value is
 *   copied to a dated quarantine key `resal_corrupt_<name>_<YYYYMMDD-HHmmss>` and the app falls back
 *   to an empty/default value.
 * - `resal_schema_version` records the data format version; migrations are additive only
 *   (existing key names and value formats are never changed or removed).
 */
import { STORAGE_PREFIX } from './storageKeys';

export const SCHEMA_VERSION_KEY = `${STORAGE_PREFIX}schema_version`;
export const CURRENT_SCHEMA_VERSION = 1;
export const QUARANTINE_PREFIX = `${STORAGE_PREFIX}corrupt_`;

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const quarantined: string[] = [];

/** Quarantine keys created during this session (for showing a notice). */
export function getQuarantinedKeys(): string[] {
  return [...quarantined];
}

/** Copies a raw (corrupt) value to a dated quarantine key. Returns the key, or null if it could not be saved. */
export function quarantineValue(key: string, raw: string, opts: { storage?: Storage; now?: Date } = {}): string | null {
  const s = getStorage(opts.storage);
  if (!s) return null;
  const name = key.startsWith(STORAGE_PREFIX) ? key.slice(STORAGE_PREFIX.length) : key;
  let qKey = `${QUARANTINE_PREFIX}${name}_${stamp(opts.now || new Date())}`;
  let i = 1;
  while (s.getItem(qKey) !== null && s.getItem(qKey) !== raw) qKey = `${qKey}_${i++}`;
  try {
    s.setItem(qKey, raw);
    quarantined.push(qKey);
    return qKey;
  } catch {
    return null;
  }
}

export interface ReadOptions<T> {
  storage?: Storage;
  validate?: (v: unknown) => v is T;
  now?: Date;
}

/**
 * Reads and parses a JSON value. Missing => fallback. Corrupt or invalid => quarantined + fallback.
 * When a value is quarantined and the original key is left as-is it would be overwritten by the next
 * save, which is safe because the raw text is preserved in the quarantine key.
 */
export function readJSON<T>(key: string, fallback: T, opts: ReadOptions<T> = {}): T {
  const s = getStorage(opts.storage);
  if (!s) return fallback;
  let raw: string | null;
  try {
    raw = s.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const q = quarantineValue(key, raw, opts);
    console.warn(`[storage] corrupt JSON in "${key}" was moved to "${q}"`);
    return fallback;
  }
  if (opts.validate && !opts.validate(parsed)) {
    const q = quarantineValue(key, raw, opts);
    console.warn(`[storage] unexpected data shape in "${key}" was moved to "${q}"`);
    return fallback;
  }
  return parsed as T;
}

export const isArray = (v: unknown): v is any[] => Array.isArray(v);
export const isPlainObject = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function readArray<T>(key: string, fallback: T[], opts: { storage?: Storage; now?: Date } = {}): T[] {
  return readJSON<T[]>(key, fallback, { ...opts, validate: isArray as (v: unknown) => v is T[] });
}

export function readObject<T extends Record<string, any>>(key: string, fallback: T, opts: { storage?: Storage; now?: Date } = {}): T {
  return readJSON<T>(key, fallback, { ...opts, validate: isPlainObject as (v: unknown) => v is T });
}

/** Writes a JSON value; returns false (instead of throwing) when storage is full/unavailable. */
export function writeJSON(key: string, value: unknown, storage?: Storage): boolean {
  const s = getStorage(storage);
  if (!s) return false;
  try {
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[storage] could not save "${key}"`, (e as Error)?.name);
    return false;
  }
}

/**
 * Additive migrations keyed by the version they upgrade TO. They must never delete or rename
 * existing keys or change existing value formats.
 */
export const MIGRATIONS: Record<number, (storage: Storage) => void> = {
  // v1: introduces the schema version stamp only (no data changes).
  1: () => {},
};

export function getSchemaVersion(storage?: Storage): number {
  const s = getStorage(storage);
  const raw = s?.getItem(SCHEMA_VERSION_KEY);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Runs pending migrations in order and stamps the schema version. Returns the versions applied. */
export function runMigrations(storage?: Storage, target = CURRENT_SCHEMA_VERSION): number[] {
  const s = getStorage(storage);
  if (!s) return [];
  const current = getSchemaVersion(s);
  if (current > target) {
    // Data written by a newer app version: never downgrade or touch it.
    console.warn(`[storage] data schema v${current} is newer than app v${target}`);
    return [];
  }
  const applied: number[] = [];
  for (let v = current + 1; v <= target; v++) {
    const m = MIGRATIONS[v];
    if (m) m(s);
    applied.push(v);
    s.setItem(SCHEMA_VERSION_KEY, String(v));
  }
  return applied;
}
