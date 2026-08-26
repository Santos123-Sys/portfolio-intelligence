import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session-token';

export async function middleware(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = secret && token ? await verifySessionToken(token, secret) : null;
  if (valid) return NextResponse.next();

  const forwardedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  const forwardedProtocol = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  const login = new URL('/login', `${forwardedProtocol}://${forwardedHost}`);
  login.searchParams.set('returnTo', `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!api|login|_next/static|_next/image|favicon.ico).*)'],
};
