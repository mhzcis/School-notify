import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_KEY, getSchemaVersion, readArray, readJSON, readObject,
  runMigrations, writeJSON,
} from './storage';

const now = new Date(2026, 0, 2, 3, 4, 5);

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('readJSON / readArray', () => {
  it('returns fallback when missing', () => {
    expect(readArray('resal_students', [])).toEqual([]);
  });

  it('reads valid data unchanged', () => {
    localStorage.setItem('resal_students', JSON.stringify([{ id: 'S1', name: 'طالب تجريبي' }]));
    expect(readArray('resal_students', [])).toEqual([{ id: 'S1', name: 'طالب تجريبي' }]);
  });

  it('quarantines corrupt JSON under a dated key and returns the fallback', () => {
    localStorage.setItem('resal_logs', '[{"broken":');
    expect(readArray('resal_logs', [], { now })).toEqual([]);
    expect(localStorage.getItem('resal_corrupt_logs_20260102-030405')).toBe('[{"broken":');
    // the original raw value is untouched until the app saves new data
    expect(localStorage.getItem('resal_logs')).toBe('[{"broken":');
  });

  it('quarantines a value of the wrong shape (object where an array is expected)', () => {
    localStorage.setItem('resal_students', '{"oops":1}');
    expect(readArray('resal_students', [], { now })).toEqual([]);
    expect(localStorage.getItem('resal_corrupt_students_20260102-030405')).toBe('{"oops":1}');
  });

  it('readObject rejects arrays; readJSON without validator accepts anything parseable', () => {
    localStorage.setItem('resal_silent_gateway_config', '[1,2]');
    expect(readObject('resal_silent_gateway_config', { a: 1 }, { now })).toEqual({ a: 1 });
    localStorage.setItem('resal_x', '5');
    expect(readJSON('resal_x', 0)).toBe(5);
  });

  it('writeJSON returns false instead of throwing when storage is full', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(writeJSON('resal_logs', [1])).toBe(false);
    spy.mockRestore();
    expect(writeJSON('resal_logs', [1])).toBe(true);
  });
});

describe('migrations', () => {
  it('stamps the schema version without touching existing data', () => {
    localStorage.setItem('resal_students', '[]');
    localStorage.setItem('resal_templates', '[{"id":"T1"}]');
    expect(getSchemaVersion()).toBe(0);
    expect(runMigrations()).toEqual([1]);
    expect(localStorage.getItem(SCHEMA_VERSION_KEY)).toBe(String(CURRENT_SCHEMA_VERSION));
    expect(localStorage.getItem('resal_students')).toBe('[]');
    expect(localStorage.getItem('resal_templates')).toBe('[{"id":"T1"}]');
    expect(runMigrations()).toEqual([]); // idempotent
  });

  it('never downgrades data from a newer version', () => {
    localStorage.setItem(SCHEMA_VERSION_KEY, '99');
    expect(runMigrations()).toEqual([]);
    expect(localStorage.getItem(SCHEMA_VERSION_KEY)).toBe('99');
  });
});
