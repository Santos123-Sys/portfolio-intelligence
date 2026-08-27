import { and, eq } from 'drizzle-orm';
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
import { getEnv } from '@/lib/env';
import { MAX_PASSWORD_LENGTH, verifyPassword } from '@/lib/password';
import { readBoundedJson } from '@/lib/request-body';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpEnrollmentUri,
  verifyTotpCode,
} from '@/lib/totp';

export const runtime = 'nodejs';

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});
const confirmationSchema = passwordSchema.extend({ code: z.string().trim().regex(/^\d{6}$/) });
const disableSchema = passwordSchema.extend({ code: z.string().trim().min(6).max(64) });
const NO_STORE_HEADERS = { 'cache-control': 'no-store' };

function requireMfaKey(): string | null {
  return getEnv().MFA_ENCRYPTION_KEY ?? null;
}

async function authorizeSensitiveAction(req: Request, currentPassword: string) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session;
  const rateLimit = await checkLoginRateLimit(session.auth.email, req);
  if (rateLimit.limited) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Too many verification attempts. Try again later.' },
        { status: 429, headers: { ...NO_STORE_HEADERS, 'retry-after': String(rateLimit.retryAfterSeconds) } }
      ),
    };
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.auth.userId)).limit(1);
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    await recordLoginFailure(session.auth.email, req);
    await recordAuthenticationEvent({
      req,
      email: session.auth.email,
      userId: session.auth.userId,
      eventType: 'mfa_management',
      outcome: 'failure',
    });
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Current password is invalid' }, { status: 401, headers: NO_STORE_HEADERS }),
    };
  }
  await clearAccountLoginFailures(session.auth.email);
  return { ok: true as const, auth: session.auth, user };
}

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const [user] = await db.select({
    enabledAt: users.mfaEnabledAt,
    pendingSecret: users.mfaPendingSecretEncrypted,
    recoveryHashes: users.mfaRecoveryCodeHashes,
  }).from(users).where(eq(users.id, session.auth.userId)).limit(1);
  return NextResponse.json({
    enabled: Boolean(user?.enabledAt),
    setupPending: Boolean(user?.pendingSecret),
    recoveryCodesRemaining: user?.recoveryHashes?.length ?? 0,
    enrollmentAvailable: Boolean(requireMfaKey()),
  }, { headers: NO_STORE_HEADERS });
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'MFA setup rejected' }, { status: 403, headers: NO_STORE_HEADERS });
  }
  const body = await readBoundedJson(req, 4 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: NO_STORE_HEADERS });
  const parsed = passwordSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid MFA setup request' }, { status: 400, headers: NO_STORE_HEADERS });
  const authorized = await authorizeSensitiveAction(req, parsed.data.currentPassword);
  if (!authorized.ok) return authorized.response;
  if (authorized.user.mfaEnabledAt) {
    return NextResponse.json({ error: 'Multi-factor authentication is already enabled' }, { status: 409, headers: NO_STORE_HEADERS });
  }
  const encryptionKey = requireMfaKey();
  if (!encryptionKey) {
    return NextResponse.json({ error: 'MFA is not configured on this deployment' }, { status: 503, headers: NO_STORE_HEADERS });
  }

  const secret = generateTotpSecret();
  await db.update(users).set({
    mfaPendingSecretEncrypted: encryptTotpSecret(secret, encryptionKey),
  }).where(eq(users.id, authorized.user.id));
  await recordAuthenticationEvent({
    req,
    email: authorized.user.email,
    userId: authorized.user.id,
    eventType: 'mfa_enrollment',
    outcome: 'challenge',
  });
  return NextResponse.json({
    secret,
    enrollmentUri: totpEnrollmentUri(secret, authorized.user.email),
  }, { headers: NO_STORE_HEADERS });
}

export async function PATCH(req: Request) {
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'MFA confirmation rejected' }, { status: 403, headers: NO_STORE_HEADERS });
  }
  const body = await readBoundedJson(req, 4 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: NO_STORE_HEADERS });
  const parsed = confirmationSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: 'Enter the six-digit verification code' }, { status: 400, headers: NO_STORE_HEADERS });
  const authorized = await authorizeSensitiveAction(req, parsed.data.currentPassword);
  if (!authorized.ok) return authorized.response;
  const encryptionKey = requireMfaKey();
  if (!encryptionKey || !authorized.user.mfaPendingSecretEncrypted) {
    return NextResponse.json({ error: 'Start MFA setup before confirming it' }, { status: 409, headers: NO_STORE_HEADERS });
  }

  let secret: string;
  let usedStep: number | null;
  try {
    secret = decryptTotpSecret(authorized.user.mfaPendingSecretEncrypted, encryptionKey);
    usedStep = verifyTotpCode(secret, parsed.data.code);
  } catch {
    usedStep = null;
    secret = '';
  }
  if (usedStep == null) {
    await recordLoginFailure(authorized.user.email, req);
    await recordAuthenticationEvent({
      req,
      email: authorized.user.email,
      userId: authorized.user.id,
      eventType: 'mfa_enrollment',
      outcome: 'failure',
    });
    return NextResponse.json({ error: 'Verification code is invalid or expired' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const recoveryCodes = generateRecoveryCodes();
  const [updated] = await db.update(users).set({
    mfaSecretEncrypted: authorized.user.mfaPendingSecretEncrypted,
    mfaPendingSecretEncrypted: null,
    mfaEnabledAt: new Date(),
    mfaRecoveryCodeHashes: recoveryCodes.map((code) => hashRecoveryCode(code, encryptionKey)),
    mfaLastUsedStep: usedStep,
  }).where(and(
    eq(users.id, authorized.user.id),
    eq(users.mfaPendingSecretEncrypted, authorized.user.mfaPendingSecretEncrypted)
  )).returning({ id: users.id });
  if (!updated) {
    return NextResponse.json({ error: 'MFA setup changed; start enrollment again' }, { status: 409, headers: NO_STORE_HEADERS });
  }
  await revokeOtherUserSessions(authorized.user.id, authorized.auth.sessionId);
  await clearAccountLoginFailures(authorized.user.email);
  await recordAuthenticationEvent({
    req,
    email: authorized.user.email,
    userId: authorized.user.id,
    eventType: 'mfa_enabled',
    outcome: 'success',
  });
  return NextResponse.json({ enabled: true, recoveryCodes }, { headers: NO_STORE_HEADERS });
}

export async function DELETE(req: Request) {
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'MFA removal rejected' }, { status: 403, headers: NO_STORE_HEADERS });
  }
  const body = await readBoundedJson(req, 4 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: NO_STORE_HEADERS });
  const parsed = disableSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: 'Password and verification code are required' }, { status: 400, headers: NO_STORE_HEADERS });
  const authorized = await authorizeSensitiveAction(req, parsed.data.currentPassword);
  if (!authorized.ok) return authorized.response;
  if (!authorized.user.mfaEnabledAt || !(await consumeUserMfaCode(authorized.user.id, parsed.data.code))) {
    await recordLoginFailure(authorized.user.email, req);
    return NextResponse.json({ error: 'Verification code is invalid or expired' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  await db.update(users).set({
    mfaSecretEncrypted: null,
    mfaPendingSecretEncrypted: null,
    mfaEnabledAt: null,
    mfaRecoveryCodeHashes: null,
    mfaLastUsedStep: null,
  }).where(eq(users.id, authorized.user.id));
  await revokeOtherUserSessions(authorized.user.id, authorized.auth.sessionId);
  await recordAuthenticationEvent({
    req,
    email: authorized.user.email,
    userId: authorized.user.id,
    eventType: 'mfa_disabled',
    outcome: 'success',
  });
  return NextResponse.json({ enabled: false, otherSessionsRevoked: true }, { headers: NO_STORE_HEADERS });
}
