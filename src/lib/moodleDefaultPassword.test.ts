import { describe, expect, it } from 'vitest';
import { attachCredentials, credentialsByNationalId, parseCredentialsTable } from './moodleCredentials';
import { missingMoodleFields, renderTemplate, SECRET_MASK, templateUsesSecrets } from './template';
import { BUILTIN_MOODLE_TEMPLATES, PASSWORD_CHANGED_TEMPLATE } from './moodleTemplates';
import { buildDispatchItems } from './recipients';
import { studentToRow } from './repo/mapping';
import { InMemorySchoolRepository as MemoryRepo } from './repo/memoryRepo';
import { blocksAutosendForCredentials } from './scheduledSend';
import { renderTemplate as renderServer, templateUsesSecrets as serverUsesSecrets } from '../../supabase/functions/school-notify-scheduled/dispatch';
import type { Student } from '../types';

// Fake fixtures only.
const FAKE_DEFAULT = 'Fake#Default1';
const student: Student = {
  id: '400000001', idNumber: '400000001', name: 'طالب تجريبي', parentName: 'ولي تجريبي',
  phone: '0590000001', phone2: '', grade: 'العاشر', section: 'أ',
} as Student;

describe('{{كلمة_المرور_الافتراضية}}', () => {
  it('renders the default password and masks it when asked', () => {
    const s = { ...student, moodleDefaultPassword: FAKE_DEFAULT };
    expect(renderTemplate('ك: {{كلمة_المرور_الافتراضية}}', s)).toBe(`ك: ${FAKE_DEFAULT}`);
    expect(renderTemplate('ك: {{كلمة_المرور_الافتراضية}}', s, { maskSecrets: true })).toBe(`ك: ${SECRET_MASK}`);
  });

  it('is a secret placeholder (extra confirm, blocked from autosend without consent)', () => {
    expect(templateUsesSecrets('{{كلمة_المرور_الافتراضية}}')).toBe(true);
    expect(blocksAutosendForCredentials('{{كلمة_المرور_الافتراضية}}', false)).toBe(true);
    expect(blocksAutosendForCredentials('{{كلمة_المرور_الافتراضية}}', true)).toBe(false);
  });

  it('reports a missing default password separately from the Moodle password', () => {
    expect(missingMoodleFields('{{كلمة_المرور_الافتراضية}}', student)).toEqual(['moodleDefaultPassword']);
    expect(missingMoodleFields('{{كلمة_المرور_الافتراضية}}', { ...student, moodlePassword: 'x' })).toEqual(['moodleDefaultPassword']);
    expect(missingMoodleFields('{{كلمة_مرور_مودل}}', { ...student, moodleDefaultPassword: 'x' })).toEqual(['moodlePassword']);
  });

  it('dispatch logContent never contains the real default password', () => {
    const creds = credentialsByNationalId([{ nationalId: '400000001', moodleUsername: 'u1', moodlePassword: '', moodleDefaultPassword: FAKE_DEFAULT }]);
    const { items } = buildDispatchItems([student], 'primary', PASSWORD_CHANGED_TEMPLATE.content,
      (tpl, s, o) => renderTemplate(tpl, attachCredentials(s, creds), o));
    expect(items[0].content).toContain(FAKE_DEFAULT);
    expect(items[0].logContent).not.toContain(FAKE_DEFAULT);
    expect(items[0].logContent).toContain(SECRET_MASK);
  });

  it('the scheduled sender renders and masks it the same way', () => {
    expect(serverUsesSecrets('{{كلمة_المرور_الافتراضية}}')).toBe(true);
    expect(renderServer('{{كلمة_المرور_الافتراضية}}', { moodleDefaultPassword: FAKE_DEFAULT })).toBe(FAKE_DEFAULT);
    expect(renderServer('{{كلمة_المرور_الافتراضية}}', { moodleDefaultPassword: FAKE_DEFAULT }, { maskSecrets: true })).toBe('••••••');
  });

  it('is never written to the student row', () => {
    const row = studentToRow({ ...student, moodleDefaultPassword: FAKE_DEFAULT } as Student, 'owner-1') as { extra?: Record<string, unknown> };
    expect(JSON.stringify(row)).not.toContain(FAKE_DEFAULT);
  });
});

describe('password-changed template', () => {
  it('is a built-in Moodle template that uses the default password placeholder', () => {
    expect(BUILTIN_MOODLE_TEMPLATES).toContain(PASSWORD_CHANGED_TEMPLATE);
    expect(PASSWORD_CHANGED_TEMPLATE.content).toContain('{{كلمة_المرور_الافتراضية}}');
    expect(PASSWORD_CHANGED_TEMPLATE.content).not.toContain('{{كلمة_مرور_مودل}}');
  });
});

describe('credentials import with a default-password column', () => {
  it('parses the column and reports which secret columns exist', () => {
    const r = parseCredentialsTable(['رقم الهوية', 'كلمة المرور الافتراضية'], [{ 'رقم الهوية': '400000001', 'كلمة المرور الافتراضية': FAKE_DEFAULT }]);
    expect(r.hasDefaultPasswordColumn).toBe(true);
    expect(r.hasPasswordColumn).toBe(false);
    expect(r.rows[0].moodleDefaultPassword).toBe(FAKE_DEFAULT);
  });

  it('leaves moodleDefaultPassword undefined when the column is absent', () => {
    const r = parseCredentialsTable(['رقم الهوية', 'كلمة المرور'], [{ 'رقم الهوية': '400000001', 'كلمة المرور': 'pw' }]);
    expect(r.hasDefaultPasswordColumn).toBe(false);
    expect(r.rows[0].moodleDefaultPassword).toBeUndefined();
  });

  it('an import without a column keeps the stored value (memory repo)', async () => {
    const repo = new MemoryRepo();
    await repo.upsertMoodleCredentials([{ nationalId: '400000001', moodleUsername: 'u', moodlePassword: 'pw1', moodleDefaultPassword: FAKE_DEFAULT }]);
    // default-password-only sheet: Moodle password must survive
    await repo.upsertMoodleCredentials([{ nationalId: '400000001', moodleUsername: 'u', moodlePassword: '', moodleDefaultPassword: 'Fake#Other2' }], { password: false, defaultPassword: true });
    let rows = (await repo.listMoodleCredentials()).rows;
    expect(rows[0].moodlePassword).toBe('pw1');
    expect(rows[0].moodleDefaultPassword).toBe('Fake#Other2');
    // password-only sheet: default password must survive
    await repo.upsertMoodleCredentials([{ nationalId: '400000001', moodleUsername: 'u', moodlePassword: 'pw2' }]);
    rows = (await repo.listMoodleCredentials()).rows;
    expect(rows[0].moodlePassword).toBe('pw2');
    expect(rows[0].moodleDefaultPassword).toBe('Fake#Other2');
  });
});
