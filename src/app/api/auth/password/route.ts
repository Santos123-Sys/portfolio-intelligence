import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, revokeOtherUserSessions } from '@/lib/auth';
import {
  checkLoginRateLimit,
  clearAccountLoginFailures,
  consumeUserMfaCode,
  recordAuthenticationEvent,
  recordLoginFailure,
} from '@/lib/auth-security';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { hashPassword, MAX_PASSWORD_LENGTH, verifyPassword } from '@/lib/password';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';

const requestSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  mfaCode: z.string().trim().min(6).max(64).optional(),
});

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Password change rejected' }, { status: 403 });
  }

  const body = await readBoundedJson(req, 4 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid password-change request' }, { status: 400 });

  const rateLimit = await checkLoginRateLimit(session.auth.email, req);
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many verification attempts. Try again later.' },
      { status: 429, headers: { 'retry-after': String(rateLimit.retryAfterSeconds) } }
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.auth.userId)).limit(1);
  const currentPasswordValid = user
    ? await verifyPassword(parsed.data.currentPassword, user.passwordHash)
    : false;
  if (!user || !currentPasswordValid) {
    await recordLoginFailure(session.auth.email, req);
    await recordAuthenticationEvent({
      req,
      email: session.auth.email,
      userId: session.auth.userId,
      eventType: 'password_change',
      outcome: 'failure',
    });
    return NextResponse.json({ error: 'Current password or verification code is invalid' }, { status: 401 });
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(parsed.data.newPassword);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'New password does not meet security requirements' },
      { status: 400 }
    );
  }

  if (await verifyPassword(parsed.data.newPassword, user.passwordHash)) {
    return NextResponse.json({ error: 'New password must be different from the current password' }, { status: 400 });
  }

  if (user.mfaEnabledAt && (
    !parsed.data.mfaCode || !(await consumeUserMfaCode(session.auth.userId, parsed.data.mfaCode))
  )) {
    await recordLoginFailure(session.auth.email, req);
    await recordAuthenticationEvent({
      req,
      email: session.auth.email,
      userId: session.auth.userId,
      eventType: 'password_change',
      outcome: 'failure',
    });
    return NextResponse.json({ error: 'Current password or verification code is invalid' }, { status: 401 });
  }

  await db.update(users).set({ passwordHash, passwordChangedAt: new Date() }).where(eq(users.id, user.id));
  await revokeOtherUserSessions(user.id, session.auth.sessionId);
  await clearAccountLoginFailures(user.email);
  await recordAuthenticationEvent({
    req,
    email: user.email,
    userId: user.id,
    eventType: 'password_change',
    outcome: 'success',
  });
  return NextResponse.json({ changed: true, otherSessionsRevoked: true });
}
