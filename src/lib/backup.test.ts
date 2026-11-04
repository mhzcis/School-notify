import { beforeEach, describe, expect, it } from 'vitest';
import { applyBackup, backupFilename, createBackup, validateBackup, BACKUP_FORMAT } from './backup';

// FAKE fixtures only — no real student data.
const fakeStudents = [
  { id: 'FAKE-1', name: 'طالب تجريبي أول', parentName: 'ولي أمر تجريبي', phone: '0599000001', grade: 'الأول', section: 'أ', moodlePassword: 'FakePass#1' },
];
const fakeGateway = { name: 'gw', smsGateCloudUsername: 'fake-user', smsGateCloudPassword: 'fake-pass', apiUrl: 'http://example.invalid' };

describe('backup', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('resal_students', JSON.stringify(fakeStudents));
    localStorage.setItem('resal_templates', '[]');
    localStorage.setItem('resal_school_name', 'مدرسة تجريبية');
    localStorage.setItem('resal_silent_gateway_config', JSON.stringify(fakeGateway));
    localStorage.setItem('unrelated_key', 'x');
  });

  it('builds a dated filename', () => {
    expect(backupFilename(new Date(2026, 10, 4, 9, 5))).toBe('school-notify-backup-2026-11-04-0905.json');
    expect(backupFilename(new Date(2026, 0, 2, 13, 30), 'pre-restore')).toBe('school-notify-pre-restore-2026-01-02-1330.json');
  });

  it('exports all resal_* keys with a version field and nothing else', () => {
    const b = createBackup(localStorage, { includeCredentials: true });
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.version).toBe(1);
    expect(Object.keys(b.data).sort()).toEqual(['resal_school_name', 'resal_silent_gateway_config', 'resal_students', 'resal_templates']);
    expect(b.data.resal_students).toBe(localStorage.getItem('resal_students'));
  });

  it('excludes secrets by default (gateway credentials and Moodle passwords)', () => {
    const b = createBackup(localStorage);
    expect(b.credentialsIncluded).toBe(false);
    const gw = JSON.parse(b.data.resal_silent_gateway_config);
    expect(gw.smsGateCloudPassword).toBe('');
    expect(gw.smsGateCloudUsername).toBe('');
    expect(gw.apiUrl).toBe('http://example.invalid');
    const students = JSON.parse(b.data.resal_students);
    expect(students[0].moodlePassword).toBe('');
    expect(students[0].name).toBe('طالب تجريبي أول');
  });

  it('round-trips through validate + apply', () => {
    const b = createBackup(localStorage, { includeCredentials: true });
    const text = JSON.stringify(b);
    localStorage.clear();
    const v = validateBackup(text);
    expect(v.ok).toBe(true);
    if ('errors' in v) return;
    expect(v.summary.students).toBe(1);
    applyBackup(v.backup);
    expect(JSON.parse(localStorage.getItem('resal_students')!)).toEqual(fakeStudents);
    expect(localStorage.getItem('resal_school_name')).toBe('مدرسة تجريبية');
  });

  it('rejects invalid files', () => {
    expect(validateBackup('not json').ok).toBe(false);
    expect(validateBackup(JSON.stringify({ format: 'other', version: 1, data: {} })).ok).toBe(false);
    expect(validateBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99, data: { resal_x: '1' } })).ok).toBe(false);
    expect(validateBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { evil_key: '1' } })).ok).toBe(false);
    expect(validateBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { resal_students: '{broken' } })).ok).toBe(false);
    expect(validateBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { resal_students: '[{"foo":1}]' } })).ok).toBe(false);
  });

  it('apply does not delete keys that are not in the backup', () => {
    applyBackup({ format: BACKUP_FORMAT, version: 1, exportedAt: '', credentialsIncluded: false, data: { resal_school_name: 'جديد' } });
    expect(localStorage.getItem('resal_school_name')).toBe('جديد');
    expect(localStorage.getItem('resal_templates')).toBe('[]');
  });
});
