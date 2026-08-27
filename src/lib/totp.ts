import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const ENCRYPTION_AAD = Buffer.from('portfolio-intelligence:mfa:v1');

function base32Encode(value: Buffer): string {
  let bits = 0;
  let accumulator = 0;
  let output = '';
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/g, '');
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) throw new Error('Invalid base32 value');
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of normalized) {
    accumulator = (accumulator << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function deriveEncryptionKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error('MFA encryption key is not configured securely');
  return createHash('sha256').update('mfa-encryption\0').update(secret).digest();
}

function deriveRecoveryKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error('MFA encryption key is not configured securely');
  return createHash('sha256').update('mfa-recovery\0').update(secret).digest();
}

function totpForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCodeAt(secret: string, timeMs = Date.now()): string {
  return totpForStep(secret, Math.floor(timeMs / 1000 / TOTP_PERIOD_SECONDS));
}

export function verifyTotpCode(
  secret: string,
  code: string,
  options: { timeMs?: number; window?: number; minimumStep?: number | null } = {}
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor((options.timeMs ?? Date.now()) / 1000 / TOTP_PERIOD_SECONDS);
  const window = Math.min(Math.max(options.window ?? 1, 0), 2);
  for (let offset = -window; offset <= window; offset += 1) {
    const step = currentStep + offset;
    if (step < 0 || (options.minimumStep != null && step <= options.minimumStep)) continue;
    const expected = Buffer.from(totpForStep(secret, step));
    const supplied = Buffer.from(code);
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return step;
  }
  return null;
}

export function totpEnrollmentUri(secret: string, email: string): string {
  const issuer = 'Portfolio Intelligence';
  const label = `${issuer}:${email}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export function encryptTotpSecret(secret: string, encryptionSecret: string): string {
  base32Decode(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(encryptionSecret), iv);
  cipher.setAAD(ENCRYPTION_AAD);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptTotpSecret(encoded: string, encryptionSecret: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = encoded.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue || encoded.length > 512) {
    throw new Error('Invalid encrypted MFA secret');
  }
  const iv = Buffer.from(ivValue, 'base64url');
  const tag = Buffer.from(tagValue, 'base64url');
  const ciphertext = Buffer.from(ciphertextValue, 'base64url');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 128) {
    throw new Error('Invalid encrypted MFA secret');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveEncryptionKey(encryptionSecret), iv);
  decipher.setAAD(ENCRYPTION_AAD);
  decipher.setAuthTag(tag);
  const secret = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  base32Decode(secret);
  return secret;
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const value = base32Encode(randomBytes(8)).slice(0, 12);
    return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
  });
}

export function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

export function hashRecoveryCode(code: string, encryptionSecret: string): string {
  return createHmac('sha256', deriveRecoveryKey(encryptionSecret))
    .update(normalizeRecoveryCode(code))
    .digest('base64url');
}

export function findRecoveryCodeIndex(code: string, hashes: string[], encryptionSecret: string): number | null {
  const candidate = Buffer.from(hashRecoveryCode(code, encryptionSecret));
  for (let index = 0; index < hashes.length; index += 1) {
    const expected = Buffer.from(hashes[index]);
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return index;
  }
  return null;
}
