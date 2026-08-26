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
import { verifyPassword } from '@/lib/password';

export const runtime = 'nodejs';

const credentialsSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(12).max(256),
});
const DUMMY_PASSWORD_HASH = 'scrypt$16384$8$1$mp3PHTuIgrVeF1ZH3Kty_Q$62tLjtiAV4rlroJ6T948Mqvijw4fHWpiGTKOGMfK7QL2y5pKJpm-Rtziu9tqqNqJLeMyS8xP4AZlNOjmD0ElwA';

export async function GET(req: Request) {
  const session = await getOptionalSession(req);
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.userId,
      email: session.email,
      displayName: session.displayName,
      role: session.role,
    },
  });
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Login request rejected' }, { status: 403 });
  }

  const parsed = credentialsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);

  const valid = user && !user.disabledAt
    ? await verifyPassword(parsed.data.password, user.passwordHash)
    : await verifyPassword(parsed.data.password, DUMMY_PASSWORD_HASH);
  if (!user || !valid || user.disabledAt) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const session = await createUserSession(user.id);
  const response = NextResponse.json({
    authenticated: true,
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
  });
  response.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(session.expiresAt));
  return response;
}

export async function DELETE(req: Request) {
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Logout request rejected' }, { status: 403 });
  }
  await revokeSession(req);
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
  });
  return response;
}
