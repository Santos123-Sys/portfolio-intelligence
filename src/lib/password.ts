import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;

function derive(password: string, salt: Buffer, length: number, cost: number, blockSize: number, parallelization: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, { N: cost, r: blockSize, p: parallelization }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error('Password must contain at least 12 characters');
  const salt = randomBytes(16);
  const derived = await derive(password, salt, KEY_LENGTH, COST, BLOCK_SIZE, PARALLELIZATION);
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELIZATION}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, saltValue, hashValue] = encoded.split('$');
  if (algorithm !== 'scrypt' || !cost || !blockSize || !parallelization || !saltValue || !hashValue) {
    return false;
  }

  try {
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = await derive(
      password,
      Buffer.from(saltValue, 'base64url'),
      expected.length,
      Number(cost),
      Number(blockSize),
      Number(parallelization)
    );
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
