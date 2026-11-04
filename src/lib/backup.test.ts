import { describe, expect, it } from 'vitest';
import { applyBackup, backupFilename, createBackup, validateBackup, BACKUP_FORMAT } from './backup';
import { InMemorySchoolRepository } from './repo/memoryRepo';
import { fakeStudent, fakeStudents } from '../test/fixtures';
import { AppData } from './repo/types';

const data = (): AppData => ({
  students: [fakeStudent(1, { moodlePassword: 'fake-pw-1' }), fakeStudent(2)],
  templates: [{ id: '22222222-2222-4222-8222-222222222222', title: 'قالب تجريبي', content: 'نص', category: 'general' } as any],
  campaigns: [],
  logs: [],
});

describe('cloud backup', () => {
  it('filename pattern', () => {
    expect(backupFilename(new Date(2026, 10, 4, 9, 5))).toBe('school-notify-backup-2026-11-04-0905.json');
    expect(backupFilename(new Date(2026, 10, 4, 9, 5), 'students', 'xlsx')).toBe('school-notify-students-2026-11-04-0905.xlsx');
  });

  it('strips Moodle passwords unless secrets are included', () => {
    const b = createBackup(data());
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.secretsIncluded).toBe(false);
    expect(b.data.students[0].moodlePassword).toBe('');
    expect(createBackup(data(), { includeSecrets: true }).data.students[0].moodlePassword).toBe('fake-pw-1');
  });

  it('validate: round trip ok, rejects legacy v1, junk and bad records', () => {
    const ok = validateBackup(JSON.stringify(createBackup(data())));
    expect(ok.ok).toBe(true);
    expect((ok as any).summary).toMatchObject({ students: 2, templates: 1, campaigns: 0, logs: 0 });
    const legacy = validateBackup(JSON.stringify({ format: 'school-notify-backup', version: 1, data: { resal_students: '[]' } }));
    expect(legacy.ok).toBe(false);
    expect((legacy as any).errors[0]).toContain('قديمة');
    expect(validateBackup('not json').ok).toBe(false);
    const bad = createBackup(data()) as any;
    bad.data.students.push({ name: 'بدون هوية' });
    expect(validateBackup(JSON.stringify(bad)).ok).toBe(false);
  });

  it('restore merges into the repository and keeps existing secrets when the file has none', async () => {
    const repo = new InMemorySchoolRepository({ students: [fakeStudent(1, { moodlePassword: 'fake-pw-1' }), ...fakeStudents(1, 50)] });
    const current = (await repo.loadAll()).students;
    const file = createBackup({ ...data(), templates: [{ id: 'TMP1', title: 'قديم', content: 'نص', category: 'general' } as any] });
    await applyBackup(file, repo, current);
    const after = await repo.loadAll();
    expect(after.students.map(s => s.id).sort()).toEqual(['1000000001', '1000000002', '1000000050']);
    expect(after.students.find(s => s.id === '1000000001')!.moodlePassword).toBe('fake-pw-1');
    expect(after.templates).toHaveLength(1);
    expect(after.templates[0].id).not.toBe('TMP1'); // non-UUID ids get fresh UUIDs
  });
});
