import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import {
  assertSameOrigin,
  createUserSession,
  getOptionalSession,
  revokeSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/auth';
import {
  checkLoginRateLimit,
  clearAccountLoginFailures,
  consumeUserMfaCode,
  recordAuthenticationEvent,
  recordLoginFailure,
} from '@/lib/auth-security';
import { hashPassword, MAX_PASSWORD_LENGTH, passwordNeedsRehash, verifyPassword } from '@/lib/password';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  mfaCode: z.string().trim().min(6).max(64).optional(),
});
const DUMMY_PASSWORD_HASH = 'scrypt$131072$8$1$hp8-8GxoEpvKLVp9zvUt7w$hDkW_2kriyydVSza0G6mGY_sVNYytXHOmhoCmnIGxuHVWWE8r8Xasp9ec1MycpwJoqxIqKak--UKyQ49ZA_CJA';
const NO_STORE_HEADERS = { 'cache-control': 'no-store' };

export async function GET(req: Request) {
  const session = await getOptionalSession(req);
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401, headers: NO_STORE_HEADERS });
  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.userId,
      email: session.email,
      displayName: session.displayName,
      role: session.role,
    },
  }, { headers: NO_STORE_HEADERS });
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Login request rejected' }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const body = await readBoundedJson(req, 4 * 1024);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status, headers: NO_STORE_HEADERS });
  }
  const parsed = credentialsSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const rateLimit = await checkLoginRateLimit(parsed.data.email, req);
  if (rateLimit.limited) {
    await recordAuthenticationEvent({
      req,
      email: parsed.data.email,
      eventType: 'login',
      outcome: 'blocked',
    });
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Try again later.' },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'retry-after': String(rateLimit.retryAfterSeconds) } }
    );
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);

  let valid = false;
  if (user && !user.disabledAt) {
    const [passwordValid] = await Promise.all([
      verifyPassword(parsed.data.password, user.passwordHash),
      ...(passwordNeedsRehash(user.passwordHash)
        ? [verifyPassword(parsed.data.password, DUMMY_PASSWORD_HASH)]
        : []),
    ]);
    valid = passwordValid;
  } else {
    await verifyPassword(parsed.data.password, DUMMY_PASSWORD_HASH);
  }
  if (!user || !valid || user.disabledAt) {
    await recordLoginFailure(parsed.data.email, req);
    await recordAuthenticationEvent({
      req,
      email: parsed.data.email,
      userId: user?.id,
      eventType: 'login',
      outcome: 'failure',
    });
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  if (user.mfaEnabledAt) {
    if (!parsed.data.mfaCode) {
      await recordAuthenticationEvent({
        req,
        email: user.email,
        userId: user.id,
        eventType: 'login_mfa',
        outcome: 'challenge',
      });
      return NextResponse.json({ authenticated: false, mfaRequired: true }, { status: 202, headers: NO_STORE_HEADERS });
    }
    if (!(await consumeUserMfaCode(user.id, parsed.data.mfaCode))) {
      await recordLoginFailure(parsed.data.email, req);
      await recordAuthenticationEvent({
        req,
        email: user.email,
        userId: user.id,
        eventType: 'login_mfa',
        outcome: 'failure',
      });
      return NextResponse.json(
        { error: 'Invalid email, password, or verification code' },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }
  }

  await clearAccountLoginFailures(user.email);
  if (passwordNeedsRehash(user.passwordHash)) {
    try {
      await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, user.id));
    } catch {
      // A legacy password that no longer meets enrollment rules remains valid
      // until the user changes it from Account Security.
    }
  }
  const session = await createUserSession(user.id);
  await recordAuthenticationEvent({
    req,
    email: user.email,
    userId: user.id,
    eventType: 'login',
    outcome: 'success',
    metadata: { mfa: Boolean(user.mfaEnabledAt) },
  });
  const response = NextResponse.json({
    authenticated: true,
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
  }, { headers: NO_STORE_HEADERS });
  response.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(session.expiresAt));
  return response;
}

export async function DELETE(req: Request) {
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Logout request rejected' }, { status: 403, headers: NO_STORE_HEADERS });
  }
  const session = await getOptionalSession(req);
  await revokeSession(req);
  if (session) {
    await recordAuthenticationEvent({
      req,
      email: session.email,
      userId: session.userId,
      eventType: 'logout',
      outcome: 'success',
    }).catch(() => undefined);
  }
  const response = NextResponse.json({ authenticated: false }, { headers: NO_STORE_HEADERS });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
  });
  return response;
}
