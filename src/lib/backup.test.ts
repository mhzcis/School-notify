import { afterEach, describe, expect, it } from 'vitest';
import { applyBackup, backupFilename, backupTextLooksSensitive, createBackup, sanitizeStudentsForBackup, studentsWorkbook, validateBackup, BACKUP_FORMAT } from './backup';
import { applyBackupPrefs, collectBackupPrefs, isBackupReminderDue, lastBackupAt, markBackupDownloaded, UI_PREF_KEYS, writePref, writeUseCloudGateway } from './smsPrefs';
import { InMemorySchoolRepository } from './repo/memoryRepo';
import { fakeStudent, fakeStudents } from '../test/fixtures';
import { AppData } from './repo/types';
import { buildRecipientGroup } from './recipientGroups';
import * as XLSX from 'xlsx';

const data = (): AppData => ({
  students: [fakeStudent(1, { moodlePassword: 'fake-pw-1', notes: 'ملاحظة سرية', moodleUsername: 'user1' }), fakeStudent(2)],
  templates: [{ id: '22222222-2222-4222-8222-222222222222', title: 'قالب تجريبي', content: 'نص', category: 'general' } as any],
  campaigns: [],
  logs: [],
  groups: [buildRecipientGroup('غير الداخلين — تجريبي', ['1000000001', '1000000002'], new Date('2026-11-18T10:00:00.000Z'), '33333333-3333-4333-8333-333333333333')],
});

afterEach(() => {
  localStorage.clear();
});

describe('cloud backup', () => {
  it('filename pattern', () => {
    expect(backupFilename(new Date(2026, 10, 4, 9, 5))).toBe('school-notify-backup-2026-11-04-0905.json');
    expect(backupFilename(new Date(2026, 10, 4, 9, 5), 'students', 'xlsx')).toBe('school-notify-students-2026-11-04-0905.xlsx');
  });

  it('always strips Moodle credentials and notes, and never flags secrets as included', () => {
    const b = createBackup(data(), { prefs: { schoolName: 'مدرسة تجريبية' } });
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.secretsIncluded).toBe(false);
    expect(b.data.students[0].moodlePassword).toBeUndefined();
    expect(b.data.students[0].moodleUsername).toBeUndefined();
    expect(b.data.students[0].notes).toBeUndefined();
    expect(b.prefs?.schoolName).toBe('مدرسة تجريبية');
    expect(b.data.groups).toHaveLength(1);
    const text = JSON.stringify(b);
    expect(backupTextLooksSensitive(text)).toBe(false);
    expect(text).not.toMatch(/fake-pw-1/);
    expect(text).not.toMatch(/ملاحظة سرية/);
  });

  it('validate: round trip ok, rejects legacy v1, junk and bad records', () => {
    const ok = validateBackup(JSON.stringify(createBackup(data(), { prefs: { schoolName: 'م' } })));
    expect(ok.ok).toBe(true);
    expect((ok as any).summary).toMatchObject({ students: 2, templates: 1, campaigns: 0, logs: 0, groups: 1, hasPrefs: true, secretsIncluded: false });
    const legacy = validateBackup(JSON.stringify({ format: 'school-notify-backup', version: 1, data: { resal_students: '[]' } }));
    expect(legacy.ok).toBe(false);
    expect((legacy as any).errors[0]).toContain('قديمة');
    expect(validateBackup('not json').ok).toBe(false);
    const bad = createBackup(data()) as any;
    bad.data.students.push({ name: 'بدون هوية' });
    expect(validateBackup(JSON.stringify(bad)).ok).toBe(false);
  });

  it('accepts an older v2 file that has no prefs or groups', () => {
    const raw = {
      format: BACKUP_FORMAT,
      version: 2,
      exportedAt: '2026-11-04T08:00:00.000Z',
      secretsIncluded: false,
      data: { students: [fakeStudent(1)], templates: [], campaigns: [], logs: [] },
    };
    const ok = validateBackup(JSON.stringify(raw));
    expect(ok.ok).toBe(true);
    expect((ok as any).summary.groups).toBe(0);
    expect((ok as any).summary.hasPrefs).toBe(false);
  });

  it('restore merges into the repository, keeps existing secrets, restores prefs and groups, and never wipes extra students', async () => {
    writePref(UI_PREF_KEYS.schoolName, 'اسم قديم');
    const repo = new InMemorySchoolRepository({ students: [fakeStudent(1, { moodlePassword: 'fake-pw-1' }), ...fakeStudents(1, 50)] });
    const current = (await repo.loadAll()).students;
    const file = createBackup({
      ...data(),
      templates: [{ id: 'TMP1', title: 'قديم', content: 'نص', category: 'general' } as any],
    }, { prefs: { schoolName: 'مدرسة بعد الاستعادة', phonePrefix: '970', useCloudGateway: true } });
    await applyBackup(file, repo, current);
    const after = await repo.loadAll();
    expect(after.students.map(s => s.id).sort()).toEqual(['1000000001', '1000000002', '1000000050']);
    expect(after.students.find(s => s.id === '1000000001')!.moodlePassword).toBe('fake-pw-1');
    expect(after.templates).toHaveLength(1);
    expect(after.templates[0].id).not.toBe('TMP1');
    expect(after.groups?.map(g => g.title)).toEqual(['غير الداخلين — تجريبي']);
    expect(collectBackupPrefs().schoolName).toBe('مدرسة بعد الاستعادة');
    expect(collectBackupPrefs().phonePrefix).toBe('970');
    expect(collectBackupPrefs().useCloudGateway).toBe(true);
  });

  it('does not re-import credentials from a legacy file that still listed them', async () => {
    const repo = new InMemorySchoolRepository({ students: [fakeStudent(1)] });
    const raw = {
      format: BACKUP_FORMAT,
      version: 2,
      exportedAt: '2026-11-04T08:00:00.000Z',
      secretsIncluded: true,
      data: {
        students: [fakeStudent(1, { moodlePassword: 'should-not-land', notes: 'nope' })],
        templates: [],
        campaigns: [],
        logs: [],
      },
    };
    const parsed = validateBackup(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.secretsIncluded).toBe(false);
    expect((parsed.backup.data.students[0] as any).moodlePassword).toBeUndefined();
    await applyBackup(parsed.backup, repo, []);
    const after = await repo.loadAll();
    expect(after.students[0].moodlePassword).toBeUndefined();
    expect(after.students[0].notes).toBeUndefined();
  });

  it('student Excel export has no notes or credential columns', () => {
    const wb = studentsWorkbook(data().students);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['الطلاب']);
    expect(rows).toHaveLength(2);
    expect(rows[0]['اسم الطالب']).toBe('طالب تجريبي 1');
    const keys = Object.keys(rows[0]);
    expect(keys.join(' ')).not.toMatch(/Moodle|ملاحظات|كلمة مرور|كلمة المرور/i);
    expect(JSON.stringify(rows)).not.toMatch(/fake-pw-1/);
  });
});

describe('backup reminder and prefs', () => {
  it('round-trips non-secret prefs and never records SMSGate secrets', () => {
    writePref(UI_PREF_KEYS.schoolName, 'مدرسة تجريبية');
    writePref(UI_PREF_KEYS.phonePrefix, '970');
    writePref(UI_PREF_KEYS.smsSegmentPrice, '0.05');
    writePref(UI_PREF_KEYS.smsBatchDelaySec, '1');
    writeUseCloudGateway(true);
    const prefs = collectBackupPrefs();
    expect(prefs).toMatchObject({
      schoolName: 'مدرسة تجريبية',
      phonePrefix: '970',
      smsSegmentPrice: '0.05',
      smsBatchDelaySec: '1',
      useCloudGateway: true,
    });
    expect(JSON.stringify(prefs)).not.toMatch(/SMSGATE|password|passphrase/i);
    localStorage.clear();
    applyBackupPrefs(prefs);
    expect(collectBackupPrefs()).toMatchObject(prefs);
  });

  it('reminder is due when no backup exists, and after 7 days', () => {
    const now = new Date('2026-11-18T10:00:00.000Z');
    expect(isBackupReminderDue(now)).toBe(true);
    expect(lastBackupAt()).toBeNull();
    markBackupDownloaded(now);
    expect(isBackupReminderDue(now)).toBe(false);
    expect(isBackupReminderDue(new Date('2026-11-24T10:00:00.000Z'))).toBe(false);
    expect(isBackupReminderDue(new Date('2026-11-25T10:00:00.000Z'))).toBe(true);
  });
});

describe('sanitizeStudentsForBackup', () => {
  it('drops forbidden fields without changing the national id', () => {
    const [s] = sanitizeStudentsForBackup([fakeStudent(3, { moodlePassword: 'x', notes: 'y', moodleUsername: 'z' })]);
    expect(s.id).toBe('1000000003');
    expect(s.moodlePassword).toBeUndefined();
    expect(s.notes).toBeUndefined();
    expect(s.moodleUsername).toBeUndefined();
  });
});
