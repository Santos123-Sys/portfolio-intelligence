/**
 * Distributed job lock.
 *
 * Scheduled jobs can be retried and offer no concurrency guarantee, so two
 * refresh runs can overlap. Two concurrent runs writing FX rates and recomputing
 * metrics is silent data corruption — the kind that is miserable to diagnose
 * three months later.
 *
 * A Postgres advisory lock (`pg_try_advisory_lock`) would be the usual answer,
 * and was the answer in the Replit design. It does not work here: advisory locks
 * are session-scoped and release when the connection closes, and serverless
 * connections close constantly — often mid-job. A table row with an explicit
 * expiry survives that, at the cost of needing a TTL to recover from a crashed
 * holder.
 */

import { sql, eq, and, lt } from 'drizzle-orm';
import { db } from '../db';
import { jobLocks } from '../db/schema';

export interface LockHandle {
  lockName: string;
  holder: string;
}

/**
 * Try to acquire a lock. Returns null if another live holder has it.
 *
 * Uses INSERT ... ON CONFLICT with a WHERE guard so acquisition is a single
 * atomic statement. Checking then inserting in two steps would race.
 */
export async function acquireLock(
  lockName: string,
  ttlSeconds = 900
): Promise<LockHandle | null> {
  const holder = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const rows = await db
    .insert(jobLocks)
    .values({ lockName, holder, expiresAt, acquiredAt: new Date() })
    .onConflictDoUpdate({
      target: jobLocks.lockName,
      set: { holder, expiresAt, acquiredAt: new Date() },
      // Only steal the lock if the previous holder's lease has expired.
      where: lt(jobLocks.expiresAt, new Date()),
    })
    .returning({ holder: jobLocks.holder });

  if (rows.length === 0 || rows[0].holder !== holder) return null;
  return { lockName, holder };
}

/** Release only if we still hold it — never stomp a lock someone else took over. */
export async function releaseLock(handle: LockHandle): Promise<void> {
  await db
    .delete(jobLocks)
    .where(
      and(eq(jobLocks.lockName, handle.lockName), eq(jobLocks.holder, handle.holder))
    );
}

/** Run `fn` under a lock, or skip cleanly if another run holds it. */
export async function withLock<T>(
  lockName: string,
  fn: () => Promise<T>,
  ttlSeconds = 900
): Promise<{ ran: true; result: T } | { ran: false; reason: string }> {
  const handle = await acquireLock(lockName, ttlSeconds);
  if (!handle) {
    return { ran: false, reason: `Lock '${lockName}' held by another run` };
  }
  try {
    return { ran: true, result: await fn() };
  } finally {
    await releaseLock(handle);
  }
}
