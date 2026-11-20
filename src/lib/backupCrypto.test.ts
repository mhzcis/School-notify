import { describe, expect, it } from 'vitest';
import { decryptBackupText, encryptBackupText, isEncryptedBackup, MIN_BACKUP_PASSWORD_LEN } from './backupCrypto';

const plain = JSON.stringify({ format: 'school-notify-cloud-backup', data: { students: [{ id: '1000000001', name: 'طالب تجريبي' }] } });

describe('backupCrypto', () => {
  it('round-trips with the right password and hides the content', async () => {
    const enc = await encryptBackupText(plain, 'correct horse', { iterations: 2000 });
    expect(isEncryptedBackup(enc)).toBe(true);
    expect(JSON.stringify(enc)).not.toContain('طالب');
    expect(JSON.stringify(enc)).not.toContain('1000000001');
    expect(await decryptBackupText(enc, 'correct horse')).toBe(plain);
  });

  it('fails with a wrong password or tampered data', async () => {
    const enc = await encryptBackupText(plain, 'correct horse', { iterations: 2000 });
    await expect(decryptBackupText(enc, 'wrong horse!')).rejects.toThrow('wrong_password_or_corrupt');
    const tampered = { ...enc, data: enc.data.slice(0, -4) + 'AAAA' };
    await expect(decryptBackupText(tampered, 'correct horse')).rejects.toThrow('wrong_password_or_corrupt');
  });

  it('uses a fresh salt/iv each time and rejects short passwords', async () => {
    const a = await encryptBackupText(plain, 'correct horse', { iterations: 2000 });
    const b = await encryptBackupText(plain, 'correct horse', { iterations: 2000 });
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    await expect(encryptBackupText(plain, 'x'.repeat(MIN_BACKUP_PASSWORD_LEN - 1))).rejects.toThrow('password_too_short');
  });
});

import { createBackup, validateBackup } from './backup';
import { fakeStudent } from '../test/fixtures';

describe('encrypted backup end to end', () => {
  it('a decrypted backup validates like a plain one', async () => {
    const backup = createBackup({ students: [fakeStudent(1)], templates: [], campaigns: [], logs: [], suppressed: [{ phone: '0599000111', reason: '' }] });
    const enc = await encryptBackupText(JSON.stringify(backup), 'correct horse', { iterations: 2000 });
    const text = await decryptBackupText(enc, 'correct horse');
    const v = validateBackup(text);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.summary.students).toBe(1);
      expect(v.summary.suppressed).toBe(1);
    }
  });
});
