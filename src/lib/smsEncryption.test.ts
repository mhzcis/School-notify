import { describe, expect, it } from 'vitest';
import { createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto';
import {
  DEFAULT_ITERATIONS, buildSendBody, decryptValue, encryptValue, isEncryptedValue,
} from '../../supabase/functions/school-notify-sms/encryption';
import { sendOne } from '../../supabase/functions/school-notify-sms/gateway';

const PASS = 'fake-test-passphrase';
const ITER = 1000; // small for test speed; format carries i=

// Independent implementation = the official Node example from docs.sms-gate.app/privacy/encryption
function docsDecrypt(passphrase: string, input: string): string {
  const parts = input.split('$');
  expect(parts.length).toBe(5);
  expect(parts[1]).toBe('aes-256-cbc/pbkdf2-sha1');
  const iterations = parseInt(parts[2].split('=')[1]);
  const salt = Buffer.from(parts[3], 'base64');
  const key = pbkdf2Sync(passphrase, salt, iterations, 32, 'sha1');
  const d = createDecipheriv('aes-256-cbc', key, salt);
  return Buffer.concat([d.update(Buffer.from(parts[4], 'base64')), d.final()]).toString('utf8');
}
function docsEncrypt(passphrase: string, input: string, salt: Buffer, iterations: number): string {
  const key = pbkdf2Sync(passphrase, salt, iterations, 32, 'sha1');
  const c = createCipheriv('aes-256-cbc', key, salt);
  const ct = Buffer.concat([c.update(Buffer.from(input, 'utf8')), c.final()]);
  return `$aes-256-cbc/pbkdf2-sha1$i=${iterations}$${salt.toString('base64')}$${ct.toString('base64')}`;
}

describe('SMSGate passphrase encryption', () => {
  it('uses the documented format and default 75,000 iterations', async () => {
    const v = await encryptValue(PASS, 'x');
    expect(v).toMatch(/^\$aes-256-cbc\/pbkdf2-sha1\$i=75000\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/=]+$/);
    expect(DEFAULT_ITERATIONS).toBe(75_000);
  });
  it('our ciphertext decrypts with the docs implementation (Arabic text + number)', async () => {
    for (const plain of ['رسالة تجريبية: تم غياب الطالب اليوم', '+970590000001']) {
      const v = await encryptValue(PASS, plain, ITER);
      expect(docsDecrypt(PASS, v)).toBe(plain);
      expect(v).not.toContain(plain);
    }
  });
  it('is byte-identical to the docs implementation for a fixed salt', async () => {
    const salt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
    const ours = await encryptValue(PASS, '0590000001', ITER, new Uint8Array(salt));
    expect(ours).toBe(docsEncrypt(PASS, '0590000001', salt, ITER));
    expect(await decryptValue(PASS, ours)).toBe('0590000001');
  });
  it('fresh salt per value; wrong passphrase fails', async () => {
    const a = await encryptValue(PASS, 'same', ITER);
    const b = await encryptValue(PASS, 'same', ITER);
    expect(a).not.toBe(b);
    await expect(decryptValue('wrong', a)).rejects.toBeTruthy();
  });
  it('buildSendBody: plaintext without passphrase, encrypted text+phones+flag with it', async () => {
    expect(await buildSendBody('hi', '0590000001')).toEqual({ textMessage: { text: 'hi' }, phoneNumbers: ['0590000001'] });
    const body: any = await buildSendBody('hi', '0590000001', PASS);
    expect(body.isEncrypted).toBe(true);
    expect(isEncryptedValue(body.textMessage.text)).toBe(true);
    expect(body.phoneNumbers.every(isEncryptedValue)).toBe(true);
    expect(docsDecrypt(PASS, body.phoneNumbers[0])).toBe('0590000001');
    expect(JSON.stringify(body)).not.toContain('0590000001');
  });
  it('sendOne sends only encrypted values when a passphrase is set', async () => {
    let sent = '';
    const f = async (_u: string, init?: RequestInit) => { sent = String(init?.body); return new Response(JSON.stringify({ id: 'gw1' }), { status: 202 }); };
    const r = await sendOne({ id: 'm1', phone: '0590000001', text: 'نص سري' }, 'Basic x', f as any, PASS);
    expect(r).toEqual({ id: 'm1', ok: true, gatewayMessageId: 'gw1' });
    expect(sent).not.toContain('0590000001');
    expect(sent).not.toContain('نص سري');
    expect(JSON.parse(sent).isEncrypted).toBe(true);
  });
});
