import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { activeAccountCookieOptions, listAcceptedAccountMemberships } from '@/lib/account-scope';
import { assertSameOrigin } from '@/lib/auth';
import { readBoundedJson } from '@/lib/request-body';

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const memberships = await listAcceptedAccountMemberships(
    session.auth.actorUserId,
    session.auth.isPlatformAdmin
  );
  return NextResponse.json({
    activeAccountId: session.auth.accountId,
    accounts: memberships.map((membership) => ({
      accountId: membership.accountId,
      accountName: membership.accountName,
      accountType: membership.accountType,
      role: membership.role,
    })),
  });
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const body = await readBoundedJson(req, 8 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const payload = body.value && typeof body.value === 'object' ? body.value as { accountId?: unknown } : {};
  const accountId = typeof payload.accountId === 'string' ? payload.accountId : null;
  const accounts = await listAcceptedAccountMemberships(
    session.auth.actorUserId,
    session.auth.isPlatformAdmin
  );
  if (!accountId || !accounts.some((account) => account.accountId === accountId)) {
    return NextResponse.json({ error: 'Account access is not available' }, { status: 403 });
  }
  const response = NextResponse.json({ activeAccountId: accountId });
  response.cookies.set('portfolio_account', accountId, activeAccountCookieOptions());
  return response;
}
