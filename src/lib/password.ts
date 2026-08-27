import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const COST = 131_072;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
export const MAX_PASSWORD_LENGTH = 128;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;

const BLOCKED_PASSWORDS = new Set([
  '123456789012345',
  '1234567890123456',
  'adminadminadminadmin',
  'administrator',
  'correcthorsebatterystaple',
  'iloveyouiloveyou',
  'letmeinletmein',
  'passwordpassword',
  'password123456789',
  'portfoliointelligence',
  'qwertyqwertyqwerty',
  'qwertyuiopasdfgh',
  'welcomewelcomewelcome',
]);

function derive(password: string, salt: Buffer, length: number, cost: number, blockSize: number, parallelization: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  assertStrongPassword(password);
  const salt = randomBytes(16);
  const derived = await derive(password, salt, KEY_LENGTH, COST, BLOCK_SIZE, PARALLELIZATION);
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELIZATION}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function assertStrongPassword(password: string): void {
  if (password.length < 15) {
    throw new Error('Password must contain at least 15 characters');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must contain at most ${MAX_PASSWORD_LENGTH} characters`);
  }
  const normalized = password.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  if (BLOCKED_PASSWORDS.has(normalized) || /^(.)\1{14,}$/u.test(normalized)) {
    throw new Error('Choose a less common password or passphrase');
  }
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const [algorithm, cost, blockSize, parallelization, saltValue, hashValue] = encoded.split('$');
  if (algorithm !== 'scrypt' || !cost || !blockSize || !parallelization || !saltValue || !hashValue) {
    return false;
  }

  try {
    const expected = Buffer.from(hashValue, 'base64url');
    const parsedCost = Number(cost);
    const parsedBlockSize = Number(blockSize);
    const parsedParallelization = Number(parallelization);
    const salt = Buffer.from(saltValue, 'base64url');
    if (
      expected.length !== KEY_LENGTH ||
      salt.length !== 16 ||
      ![16_384, 32_768, 65_536, 131_072].includes(parsedCost) ||
      parsedBlockSize !== BLOCK_SIZE ||
      parsedParallelization !== PARALLELIZATION
    ) return false;
    const actual = await derive(
      password,
      salt,
      expected.length,
      parsedCost,
      parsedBlockSize,
      parsedParallelization
    );
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function passwordNeedsRehash(encoded: string): boolean {
  const [algorithm, cost, blockSize, parallelization] = encoded.split('$');
  return algorithm !== 'scrypt' || Number(cost) !== COST || Number(blockSize) !== BLOCK_SIZE || Number(parallelization) !== PARALLELIZATION;
}
