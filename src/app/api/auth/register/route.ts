import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, createUserSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';
import { AccountRegistrationError, registerMemberAccount } from '@/lib/account-registration';
import { recordAuthenticationEvent } from '@/lib/auth-security';
import { hashPassword, MAX_PASSWORD_LENGTH } from '@/lib/password';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';

const registrationSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
}).strict();

const NO_STORE_HEADERS = { 'cache-control': 'no-store' };

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Registration request rejected' }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const body = await readBoundedJson(req, 4 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers: NO_STORE_HEADERS });
  const parsed = registrationSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a valid name, email, and password' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const user = await registerMemberAccount({
      ...parsed.data,
      passwordHash: await hashPassword(parsed.data.password),
    });
    const session = await createUserSession(user.userId);
    await recordAuthenticationEvent({
      req,
      email: user.email,
      userId: user.userId,
      eventType: 'registration',
      outcome: 'success',
      metadata: { accountType: 'advisory_client' },
    });
    const response = NextResponse.json({
      authenticated: true,
      user: { id: user.userId, email: user.email, displayName: user.displayName, role: 'member' },
      account: { id: user.accountId, name: user.accountName, type: 'advisory_client' },
    }, { status: 201, headers: NO_STORE_HEADERS });
    response.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof AccountRegistrationError) {
      await recordAuthenticationEvent({
        req,
        email: parsed.data.email,
        eventType: 'registration',
        outcome: 'blocked',
        metadata: { reason: error.code },
      }).catch(() => undefined);
      return NextResponse.json({ error: error.message }, { status: error.code === 'capacity_reached' ? 403 : 409, headers: NO_STORE_HEADERS });
    }
    const message = error instanceof Error && error.message.startsWith('Password') || error instanceof Error && error.message.startsWith('Choose')
      ? error.message
      : 'Unable to create the account';
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
