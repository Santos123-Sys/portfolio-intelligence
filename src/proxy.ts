import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session-token';
import { buildContentSecurityPolicy } from '@/lib/content-security-policy';

function nextWithNonce(req: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const requestHeaders = new Headers(req.headers);
  const policy = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === 'production');
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export async function proxy(req: NextRequest) {
  const forwardedHost = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host)
    .split(',')[0]
    .trim();
  const forwardedProtocol = (req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', ''))
    .split(',')[0]
    .trim();
  let publicOrigin: string | null = null;
  if (process.env.PUBLIC_APP_URL) {
    try {
      publicOrigin = new URL(process.env.PUBLIC_APP_URL).origin;
    } catch {
      // Runtime environment validation reports the invalid value on API use.
    }
  }
  if (
    process.env.NODE_ENV === 'production' &&
    forwardedProtocol === 'http' &&
    !forwardedHost.endsWith('.railway.internal')
  ) {
    const secureUrl = new URL(
      `${req.nextUrl.pathname}${req.nextUrl.search}`,
      publicOrigin ?? `https://${forwardedHost}`
    );
    return NextResponse.redirect(secureUrl, 308);
  }

  if (req.nextUrl.pathname === '/login') return nextWithNonce(req);

  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = secret && token ? await verifySessionToken(token, secret) : null;
  if (valid) return nextWithNonce(req);

  const login = new URL('/login', publicOrigin ?? `${forwardedProtocol}://${forwardedHost}`);
  login.searchParams.set('returnTo', `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
