import { describe, expect, it } from 'vitest';
import { attachCredentials, maskCredentialPassword, parseCredentialsFile } from './moodleCredentials';
import { fakeStudent } from '../test/fixtures';

describe('dedicated Moodle credentials import', () => {
  it('imports by national ID only and ignores a name column', () => {
    const text = `رقم الهوية,اسم المستخدم,كلمة المرور,اسم الطالب
1000000001,fake.user01,Fake#Pass-0001,اسم لن يُستخدم
1000000002,fake.user02,Fake#Pass-0002,اسم آخر
`;
    const r = parseCredentialsFile({ text });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      nationalId: '1000000001',
      moodleUsername: 'fake.user01',
      moodlePassword: 'Fake#Pass-0001',
    });
    expect(r.skippedNoId).toBe(0);
  });

  it('skips rows without a national ID (never attaches a password by name)', () => {
    const text = `الاسم,كلمة المرور\nطالب تجريبي الأول,Fake#Pass-9999\n`;
    const r = parseCredentialsFile({ text });
    expect(r.rows).toHaveLength(0);
    expect(r.skippedNoId).toBe(1);
  });

  it('keeps the last row of a duplicate ID and reports it', () => {
    const text = `ID number,Username,Password
1000000001,first,Fake#Pass-A
1000000001,second,Fake#Pass-B
`;
    const r = parseCredentialsFile({ text });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].moodleUsername).toBe('second');
    expect(r.duplicateIds).toEqual(['1000000001']);
  });

  it('masks passwords for display and attaches credentials onto a student copy only', () => {
    expect(maskCredentialPassword('Fake#Pass-0001')).toBe('••••••');
    const s = fakeStudent(1);
    const attached = attachCredentials(s, new Map([
      ['1000000001', { nationalId: '1000000001', moodleUsername: 'fake.user01', moodlePassword: 'Fake#Pass-0001' }],
    ]));
    expect(s.moodlePassword).toBeUndefined();
    expect(attached.moodleUsername).toBe('fake.user01');
    expect(attached.moodlePassword).toBe('Fake#Pass-0001');
  });
});
