import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from './db';
import { accounts, memberships, users } from './db/schema';

export const ACTIVE_ACCOUNT_COOKIE = 'portfolio_account';
export const ACCOUNT_ROLES = ['owner', 'analyst', 'viewer'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export interface AccountMembership {
  accountId: string;
  accountName: string;
  accountType: string;
  role: AccountRole;
  /** Compatibility tenant key for the existing owner-scoped data tables. */
  ownerUserId: string;
}

export function activeAccountCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    priority: 'high' as const,
  };
}

/** Ensure legacy and newly-created users each have one account they own. */
export async function ensureOwnedAccount(userId: string, displayName: string): Promise<void> {
  await db.insert(accounts).values({
    name: displayName,
    accountType: 'personal',
    ownerUserId: userId,
  }).onConflictDoNothing({ target: accounts.ownerUserId });

  const [account] = await db.select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.ownerUserId, userId))
    .limit(1);
  if (!account) throw new Error('Unable to resolve the user account');

  await db.insert(memberships).values({
    userId,
    accountId: account.id,
    role: 'owner',
    acceptedAt: new Date(),
  }).onConflictDoNothing({ target: [memberships.userId, memberships.accountId] });
}

export async function listAcceptedAccountMemberships(userId: string, platformAdmin = false): Promise<AccountMembership[]> {
  if (platformAdmin) {
    return db.select({
      accountId: accounts.id,
      accountName: accounts.name,
      accountType: accounts.accountType,
      ownerUserId: accounts.ownerUserId,
    })
      .from(accounts)
      .then((rows) => rows.map((row) => ({ ...row, role: 'owner' as const })));
  }
  return db.select({
    accountId: accounts.id,
    accountName: accounts.name,
    accountType: accounts.accountType,
    role: memberships.role,
    ownerUserId: accounts.ownerUserId,
  })
    .from(memberships)
    .innerJoin(accounts, eq(memberships.accountId, accounts.id))
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.userId, userId), isNotNull(memberships.acceptedAt), isNull(users.disabledAt)))
    .then((rows) => rows.filter((row): row is AccountMembership => ACCOUNT_ROLES.includes(row.role as AccountRole)));
}

export async function resolveAccountMembership(
  userId: string,
  preferredAccountId: string | null,
  platformAdmin = false
): Promise<AccountMembership | null> {
  const membershipsForUser = await listAcceptedAccountMemberships(userId, platformAdmin);
  if (!membershipsForUser.length) return null;
  return membershipsForUser.find((membership) => membership.accountId === preferredAccountId)
    ?? membershipsForUser.find((membership) => membership.ownerUserId === userId)
    ?? membershipsForUser[0];
}

export function accountCanEdit(role: string): boolean {
  return role === 'owner' || role === 'analyst';
}
