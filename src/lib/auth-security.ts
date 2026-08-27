import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { db } from './db';
import { authenticationEvents, authenticationRateLimits, users } from './db/schema';
import { getEnv } from './env';
import { decryptTotpSecret, findRecoveryCodeIndex, verifyTotpCode } from './totp';

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const ACCOUNT_FAILURE_LIMIT = 5;
const NETWORK_FAILURE_LIMIT = 10;

type LimitKind = 'account' | 'network';

function fingerprint(kind: string, value: string): string {
  return createHmac('sha256', getEnv().SESSION_SECRET)
    .update(`portfolio-auth:${kind}\0`)
    .update(value)
    .digest('base64url');
}

export function clientAddress(req: Request): string {
  // Use the last proxy-appended hop. The first X-Forwarded-For value and
  // CF-Connecting-IP can be forged by requests that bypass the public edge.
  const forwarded = req.headers.get('x-forwarded-for')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const candidate = forwarded?.at(-1) ?? req.headers.get('x-real-ip')?.trim() ?? '';
  return isIP(candidate) ? candidate : 'unknown';
}

function limitKeys(email: string, req: Request): Array<{ keyHash: string; kind: LimitKind }> {
  return [
    { keyHash: fingerprint('account', email.trim().toLowerCase()), kind: 'account' },
    { keyHash: fingerprint('network', clientAddress(req)), kind: 'network' },
  ];
}

export async function checkLoginRateLimit(
  email: string,
  req: Request
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const now = new Date();
  const rows = await db
    .select({ blockedUntil: authenticationRateLimits.blockedUntil })
    .from(authenticationRateLimits)
    .where(
      and(
        inArray(authenticationRateLimits.keyHash, limitKeys(email, req).map((entry) => entry.keyHash)),
        gt(authenticationRateLimits.blockedUntil, now)
      )
    );
  const latest = rows.reduce<Date | null>((result, row) => {
    if (!row.blockedUntil) return result;
    return !result || row.blockedUntil > result ? row.blockedUntil : result;
  }, null);
  return latest
    ? { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((latest.getTime() - now.getTime()) / 1000)) }
    : { limited: false, retryAfterSeconds: 0 };
}

export async function recordLoginFailure(
  email: string,
  req: Request
): Promise<void> {
  const now = new Date();
  for (const entry of limitKeys(email, req)) {
    await db.transaction(async (tx) => {
      await tx.insert(authenticationRateLimits).values({
        keyHash: entry.keyHash,
        kind: entry.kind,
        failureCount: 0,
        windowStartedAt: now,
        updatedAt: now,
      }).onConflictDoNothing();

      const [current] = await tx
        .select()
        .from(authenticationRateLimits)
        .where(eq(authenticationRateLimits.keyHash, entry.keyHash))
        .for('update')
        .limit(1);
      if (!current) throw new Error('Authentication throttle row could not be locked');

      const windowExpired = now.getTime() - current.windowStartedAt.getTime() >= WINDOW_MS;
      const failureCount = windowExpired ? 1 : current.failureCount + 1;
      const failureLimit = entry.kind === 'account' ? ACCOUNT_FAILURE_LIMIT : NETWORK_FAILURE_LIMIT;
      const blockedUntil = failureCount >= failureLimit ? new Date(now.getTime() + BLOCK_MS) : null;

      await tx.update(authenticationRateLimits).set({
        failureCount,
        windowStartedAt: windowExpired ? now : current.windowStartedAt,
        blockedUntil,
        updatedAt: now,
      }).where(eq(authenticationRateLimits.keyHash, entry.keyHash));
    });
  }
}

export async function pruneAuthenticationSecurityData(now = new Date()): Promise<{
  rateLimits: number;
  events: number;
}> {
  const staleRateLimits = await db.delete(authenticationRateLimits).where(
    lt(authenticationRateLimits.updatedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))
  ).returning({ keyHash: authenticationRateLimits.keyHash });
  const staleEvents = await db.delete(authenticationEvents).where(
    lt(authenticationEvents.occurredAt, new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000))
  ).returning({ id: authenticationEvents.id });
  return { rateLimits: staleRateLimits.length, events: staleEvents.length };
}

export async function clearAccountLoginFailures(email: string): Promise<void> {
  await db.delete(authenticationRateLimits).where(
    eq(authenticationRateLimits.keyHash, fingerprint('account', email.trim().toLowerCase()))
  );
}

export async function recordAuthenticationEvent(input: {
  req: Request;
  eventType: string;
  outcome: 'success' | 'failure' | 'blocked' | 'challenge';
  email?: string | null;
  userId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  const userAgent = input.req.headers.get('user-agent');
  const metadata = input.metadata
    ? Object.fromEntries(
        Object.entries(input.metadata).slice(0, 12).map(([key, value]) => [
          key.slice(0, 64),
          typeof value === 'string' ? value.slice(0, 128) : value,
        ])
      )
    : undefined;
  await db.insert(authenticationEvents).values({
    userId: input.userId ?? null,
    eventType: input.eventType.slice(0, 64),
    outcome: input.outcome,
    identityHash: input.email ? fingerprint('identity-event', input.email.trim().toLowerCase()) : null,
    ipHash: fingerprint('ip-event', clientAddress(input.req)),
    userAgentHash: userAgent ? fingerprint('user-agent', userAgent.slice(0, 512)) : null,
    metadata,
  });
}

/** Consumes a TOTP step or recovery code atomically so neither can be replayed. */
export async function consumeUserMfaCode(userId: string, code: string): Promise<boolean> {
  const encryptionSecret = getEnv().MFA_ENCRYPTION_KEY;
  if (!encryptionSecret) return false;
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        secret: users.mfaSecretEncrypted,
        recoveryHashes: users.mfaRecoveryCodeHashes,
        lastUsedStep: users.mfaLastUsedStep,
        enabledAt: users.mfaEnabledAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);
    if (!user?.enabledAt || !user.secret) return false;

    try {
      const secret = decryptTotpSecret(user.secret, encryptionSecret);
      const step = verifyTotpCode(secret, code.trim(), { minimumStep: user.lastUsedStep });
      if (step != null) {
        await tx.update(users).set({ mfaLastUsedStep: step }).where(eq(users.id, userId));
        return true;
      }

      const recoveryHashes = user.recoveryHashes ?? [];
      const recoveryIndex = findRecoveryCodeIndex(code, recoveryHashes, encryptionSecret);
      if (recoveryIndex == null) return false;
      await tx.update(users).set({
        mfaRecoveryCodeHashes: recoveryHashes.filter((_, index) => index !== recoveryIndex),
      }).where(eq(users.id, userId));
      return true;
    } catch {
      return false;
    }
  });
}
