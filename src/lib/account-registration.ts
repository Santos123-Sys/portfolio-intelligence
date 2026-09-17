import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { accounts, memberships, users } from '@/lib/db/schema';

/** A deliberately small launch cohort; change only through a reviewed release. */
export const MAX_SELF_SERVICE_MEMBER_ACCOUNTS = 2;

export class AccountRegistrationError extends Error {
  constructor(
    readonly code: 'capacity_reached' | 'email_unavailable',
    message: string
  ) {
    super(message);
    this.name = 'AccountRegistrationError';
  }
}

export interface MemberRegistration {
  email: string;
  displayName: string;
  passwordHash: string;
}

/**
 * Creates a new client identity and its isolated account in one transaction.
 * The advisory transaction lock makes the two-account ceiling safe when two
 * registrations arrive at the same time or from different dashboard replicas.
 */
export async function registerMemberAccount(input: MemberRegistration): Promise<{
  userId: string;
  email: string;
  displayName: string;
  accountId: string;
  accountName: string;
}> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('portfolio_intelligence_member_registration'))`);

    const [existing] = await tx.select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (existing) {
      throw new AccountRegistrationError('email_unavailable', 'This email cannot be used for registration');
    }

    const [activeMembers] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, 'member'), isNull(users.disabledAt)));
    if ((activeMembers?.count ?? 0) >= MAX_SELF_SERVICE_MEMBER_ACCOUNTS) {
      throw new AccountRegistrationError(
        'capacity_reached',
        'Client registration is currently full. Contact the platform administrator for access.'
      );
    }

    const [user] = await tx.insert(users).values({
      email: input.email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      role: 'member',
    }).returning({ id: users.id, email: users.email, displayName: users.displayName });

    const accountName = `${user.displayName}'s portfolio`;
    const [account] = await tx.insert(accounts).values({
      name: accountName,
      accountType: 'advisory_client',
      ownerUserId: user.id,
    }).returning({ id: accounts.id, name: accounts.name });

    await tx.insert(memberships).values({
      userId: user.id,
      accountId: account.id,
      role: 'owner',
      acceptedAt: new Date(),
    });

    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      accountId: account.id,
      accountName: account.name,
    };
  });
}
