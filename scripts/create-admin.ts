import { eq } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { users } from '../src/lib/db/schema';
import { readInitialAdminConfig } from '../src/lib/initial-admin-config';
import { hashPassword } from '../src/lib/password';

async function main() {
  const optional = process.argv.includes('--if-configured');
  const config = readInitialAdminConfig(process.env, { optional });
  if (!config) {
    console.log('Initial administrator variables are absent; skipping one-time owner bootstrap.');
    return;
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, config.email)).limit(1);
  if (existing) {
    console.log('The initial administrator already exists; no password was changed.');
    return;
  }

  const [user] = await db.insert(users).values({
    email: config.email,
    displayName: config.displayName,
    passwordHash: await hashPassword(config.password),
    role: 'owner',
  }).returning({ id: users.id });
  console.log(`Created initial administrator (${user.id}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
