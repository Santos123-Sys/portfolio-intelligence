import { z } from 'zod';

export interface InitialAdminConfig {
  email: string;
  password: string;
  displayName: string;
}

export function readInitialAdminConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { optional?: boolean } = {}
): InitialAdminConfig | null {
  const email = env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.INITIAL_ADMIN_PASSWORD;
  const displayName = env.INITIAL_ADMIN_NAME?.trim() || 'Portfolio Owner';

  if (!email && !password && options.optional) return null;
  if (!email || !password) {
    throw new Error('Set both INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD before creating the owner account');
  }
  if (!z.string().email().safeParse(email).success) {
    throw new Error('INITIAL_ADMIN_EMAIL must be a valid email address');
  }

  return { email, password, displayName };
}
