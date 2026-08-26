import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from './db';
import { users, userSessions } from './db/schema';
import { getEnv } from './env';
import { digestSessionPayload, SESSION_COOKIE, signSessionPayload, verifySessionToken } from './session-token';

export { SESSION_COOKIE };
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  sessionId: string;
}

function requestCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
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
        isNull(userSessions.revokedAt),
        isNull(users.disabledAt)
      )
    )
    .limit(1);

  if (!row || row.tokenHash !== (await digestSessionPayload(verified.payload))) return null;
  await db.update(userSessions).set({ lastSeenAt: new Date() }).where(eq(userSessions.id, row.sessionId));
  return row;
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

export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) return;
  const expectedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!expectedHost || new URL(origin).host !== expectedHost) throw new Error('Cross-origin mutation rejected');
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
