/**
 * Optional password protection for backup files (Web Crypto, in the browser only).
 *
 *   key  = PBKDF2-SHA-256(password, 16-byte random salt, 310 000 iterations) -> AES-256
 *   data = AES-GCM(key, 12-byte random iv, UTF-8 JSON of the normal backup file)
 *
 * The password is never stored or sent anywhere. Without it the file cannot be opened.
 */
export const ENCRYPTED_BACKUP_FORMAT = 'school-notify-encrypted-backup';
export const ENCRYPTED_BACKUP_VERSION = 1;
export const PBKDF2_ITERATIONS = 310_000;
export const MIN_BACKUP_PASSWORD_LEN = 8;

export interface EncryptedBackupFile {
  format: typeof ENCRYPTED_BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  data: string;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('crypto_unavailable');
  return c.subtle;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function isEncryptedBackup(parsed: unknown): parsed is EncryptedBackupFile {
  return !!parsed && typeof parsed === 'object' && (parsed as any).format === ENCRYPTED_BACKUP_FORMAT;
}

export async function encryptBackupText(
  plainJson: string,
  password: string,
  opts: { iterations?: number; now?: Date } = {},
): Promise<EncryptedBackupFile> {
  if (password.length < MIN_BACKUP_PASSWORD_LEN) throw new Error('password_too_short');
  const iterations = opts.iterations ?? PBKDF2_ITERATIONS;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(plainJson)));
  return {
    format: ENCRYPTED_BACKUP_FORMAT,
    version: ENCRYPTED_BACKUP_VERSION,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(ct),
  };
}

/** Returns the decrypted JSON text. Throws Error('wrong_password_or_corrupt') on failure. */
export async function decryptBackupText(file: EncryptedBackupFile, password: string): Promise<string> {
  try {
    if (file.kdf?.name !== 'PBKDF2' || file.cipher?.name !== 'AES-GCM') throw new Error('unsupported');
    const iterations = Number(file.kdf.iterations);
    if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 5_000_000) throw new Error('unsupported');
    const key = await deriveKey(password, fromBase64(file.kdf.salt), iterations);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(file.cipher.iv) as BufferSource }, key, fromBase64(file.data) as BufferSource);
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('wrong_password_or_corrupt');
  }
}
