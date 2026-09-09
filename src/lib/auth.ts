import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import { db } from './db';
import { users, userSessions } from './db/schema';
import { ensureOwnedAccount, resolveAccountMembership } from './account-scope';
import { getEnv } from './env';
import { digestSessionPayload, SESSION_COOKIE, signSessionPayload, verifySessionToken } from './session-token';
import { validateMutationOrigin } from './request-security';

export { SESSION_COOKIE };
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;
export const SESSION_IDLE_SECONDS = 60 * 60 * 8;

export interface AuthContext {
  /** The signed-in human. Use this for authentication-security operations. */
  actorUserId: string;
  /**
   * Compatibility tenant key. Existing portfolio and workflow records remain
   * keyed by this account owner's user id during the staged migration.
   */
  userId: string;
  email: string;
  displayName: string;
  role: string;
  /** Platform administrators may switch to every client account. */
  isPlatformAdmin: boolean;
  sessionId: string;
  accountId: string;
  accountName: string;
  accountType: string;
}

function requestCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function createUserSession(userId: string): Promise<{ value: string; expiresAt: Date }> {
  const env = getEnv();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);
  const payload = `${sessionId}.${expiresAt.getTime()}.${randomBytes(32).toString('base64url')}`;
  const value = await signSessionPayload(payload, env.SESSION_SECRET);
  await db.insert(userSessions).values({
    id: sessionId,
    userId,
    tokenHash: await digestSessionPayload(payload),
    expiresAt,
  });
  return { value, expiresAt };
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
    priority: 'high' as const,
  };
}

export async function getOptionalSession(req: Request): Promise<AuthContext | null> {
  const token = requestCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const verified = await verifySessionToken(token, getEnv().SESSION_SECRET);
  if (!verified) return null;

  const [row] = await db
    .select({
      sessionId: userSessions.id,
      tokenHash: userSessions.tokenHash,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
    })
    .from(userSessions)
    .innerJoin(users, eq(userSessions.userId, users.id))
    .where(
      and(
        eq(userSessions.id, verified.sessionId),
        gt(userSessions.expiresAt, new Date()),
        gt(userSessions.lastSeenAt, new Date(Date.now() - SESSION_IDLE_SECONDS * 1000)),
        isNull(userSessions.revokedAt),
        isNull(users.disabledAt)
      )
    )
    .limit(1);

  if (!row || row.tokenHash !== (await digestSessionPayload(verified.payload))) return null;
  await ensureOwnedAccount(row.userId, row.displayName);
  // `users.role` is retained only as the platform-admin bootstrap flag.  All
  // ordinary authorization comes from the selected account membership.
  const isPlatformAdmin = row.role === 'platform_admin';
  const membership = await resolveAccountMembership(
    row.userId,
    requestCookie(req, 'portfolio_account'),
    isPlatformAdmin
  );
  if (!membership) return null;
  await db.update(userSessions).set({ lastSeenAt: new Date() }).where(eq(userSessions.id, row.sessionId));
  return {
    ...row,
    actorUserId: row.userId,
    userId: membership.ownerUserId,
    role: membership.role,
    isPlatformAdmin,
    accountId: membership.accountId,
    accountName: membership.accountName,
    accountType: membership.accountType,
  };
}

export async function requireSession(req: Request): Promise<AuthContext> {
  const session = await getOptionalSession(req);
  if (!session) throw new Error('Authentication required');
  return session;
}

export async function revokeSession(req: Request): Promise<void> {
  const token = requestCookie(req, SESSION_COOKIE);
  if (!token) return;
  const verified = await verifySessionToken(token, getEnv().SESSION_SECRET);
  if (!verified) return;
  await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, verified.sessionId));
}

export async function revokeOtherUserSessions(userId: string, currentSessionId: string): Promise<void> {
  await db.update(userSessions).set({ revokedAt: new Date() }).where(
    and(eq(userSessions.userId, userId), ne(userSessions.id, currentSessionId), isNull(userSessions.revokedAt))
  );
}

export function assertSameOrigin(req: Request): void {
  const env = getEnv();
  validateMutationOrigin(req, {
    production: env.NODE_ENV === 'production',
    publicAppUrl: env.PUBLIC_APP_URL,
  });
}

export function assertAgenticServiceAuthorized(req: Request): void {
  const expected = getEnv().AGENTIC_SYSTEM_API_KEY;
  if (!expected) throw new Error('AGENTIC_SYSTEM_API_KEY is not configured');
  const bearer = req.headers.get('authorization');
  const supplied = req.headers.get('x-agentic-api-key') ??
    (bearer?.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : null);
  if (!supplied) throw new Error('Agentic service authentication required');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Invalid agentic service credential');
}
