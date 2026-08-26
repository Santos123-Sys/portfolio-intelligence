/**
 * Environment validation. Fails loudly at startup, naming the missing key.
 *
 * Vercel scopes env vars per environment (Production / Preview / Development).
 * A variable set on one is not visible to the others. This module exists so
 * that mistake surfaces as a named error rather than an undefined at runtime.
 */
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid Postgres connection string'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  MARKET_DATA_API_KEY: z.string().min(1).optional(),
  MARKET_DATA_PROVIDER: z.enum(['stub', 'twelvedata', 'eodhd']).default('stub'),
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 chars').optional(),
  AGENT_VERSION: z.string().default('agenteki-0.1.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Environment validation failed:\n${missing}\n\n` +
        `On Vercel, set these under Project Settings > Environment Variables, ` +
        `and confirm the correct environment (Production / Preview / Development) is ticked.`
    );
  }
  cached = parsed.data;
  return cached;
}

/** Guards cron routes. Vercel sends CRON_SECRET as a bearer token. */
export function assertCronAuthorized(req: Request): void {
  const env = getEnv();
  if (!env.CRON_SECRET) {
    if (env.NODE_ENV === 'production') {
      throw new Error('CRON_SECRET is required in production; cron routes are public without it');
    }
    return;
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    throw new Error('Unauthorized cron invocation');
  }
}
