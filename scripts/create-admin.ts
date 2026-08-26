import { eq } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { users } from '../src/lib/db/schema';
import { hashPassword } from '../src/lib/password';

async function main() {
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const displayName = process.env.INITIAL_ADMIN_NAME?.trim() || 'Portfolio Owner';
  if (!email || !password) {
    throw new Error('Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD before creating the owner account');
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    console.log(`Administrator ${email} already exists; no password was changed.`);
    return;
  }

  const [user] = await db.insert(users).values({
    email,
    displayName,
    passwordHash: await hashPassword(password),
    role: 'owner',
  }).returning({ id: users.id, email: users.email });
  console.log(`Created administrator ${user.email} (${user.id}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
