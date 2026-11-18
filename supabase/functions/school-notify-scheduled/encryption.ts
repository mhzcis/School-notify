/**
 * SMSGate passphrase encryption (https://docs.sms-gate.app/privacy/encryption/ — "Passphrase Encryption"):
 *  - key = PBKDF2-HMAC-SHA1(passphrase, salt, i iterations, 32 bytes); random 16-byte salt per value
 *  - AES-256-CBC (PKCS#7) with IV = salt (as in the official PHP/Node/Python examples)
 *  - format: `$aes-256-cbc/pbkdf2-sha1$i=<iterations>$<base64(salt)>$<base64(ciphertext)>`
 *  - encrypt textMessage.text and EVERY phoneNumbers value separately; send `isEncrypted: true`.
 * WebCrypto only (works in Deno and Node). The passphrase comes from the server secret
 * SMSGATE_ENCRYPTION_PASSPHRASE and is never logged or returned.
 */
export const ENC_PREFIX = '$aes-256-cbc/pbkdf2-sha1$';
/** Application default in SMSGate docs; the device reads `i` from each value. */
export const DEFAULT_ITERATIONS = 75_000;

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number, usage: KeyUsage): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-1', salt, iterations },
    base,
    { name: 'AES-CBC', length: 256 },
    false,
    [usage]
  );
}

export async function encryptValue(
  passphrase: string,
  plain: string,
  iterations = DEFAULT_ITERATIONS,
  salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16))
): Promise<string> {
  const key = await deriveKey(passphrase, salt, iterations, 'encrypt');
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: salt }, key, new TextEncoder().encode(plain)));
  return `${ENC_PREFIX}i=${iterations}$${b64(salt)}$${b64(ct)}`;
}

export function isEncryptedValue(s: unknown): boolean {
  return typeof s === 'string' && s.startsWith(ENC_PREFIX);
}

/** Decrypts a value in the documented format (used for tests and, if ever needed, webhook recipients). */
export async function decryptValue(passphrase: string, value: string): Promise<string> {
  const parts = value.split('$');
  if (parts.length !== 5 || parts[1] !== 'aes-256-cbc/pbkdf2-sha1') throw new Error('unsupported_format');
  const params = new Map(parts[2].split(',').map(p => p.split('=', 2) as [string, string]));
  const iterations = Number(params.get('i'));
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error('missing_iterations');
  const salt = unb64(parts[3]);
  const key = await deriveKey(passphrase, salt, iterations, 'decrypt');
  const pt = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: salt }, key, unb64(parts[4]));
  return new TextDecoder().decode(pt);
}

/** Builds the SMSGate send body; encrypted when a passphrase is given. */
export async function buildSendBody(text: string, phone: string, passphrase?: string): Promise<Record<string, unknown>> {
  if (!passphrase) return { textMessage: { text }, phoneNumbers: [phone] };
  return {
    textMessage: { text: await encryptValue(passphrase, text) },
    phoneNumbers: [await encryptValue(passphrase, phone)],
    isEncrypted: true,
  };
}
