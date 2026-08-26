/**
 * Environment validation. Fails loudly at startup, naming the missing key.
 *
 * This module keeps Railway/runtime configuration failures explicit rather than
 * allowing an undefined credential to fail deep inside a request.
 */
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid Postgres connection string'),
  MARKET_DATA_API_KEY: z.string().min(1).optional(),
  MARKET_DATA_PROVIDER: z.enum(['stub', 'twelvedata', 'eodhd', 'yahoo-search']).default('stub'),
  WEB_SEARCH_PROVIDER: z.enum(['none', 'brave']).default('none'),
  WEB_SEARCH_API_KEY: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must contain at least 32 characters'),
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 chars').optional(),
  /** External Agentic System integration; the dashboard never owns its prompts. */
  AGENTIC_SYSTEM_BASE_URL: z.string().url().optional(),
  AGENTIC_SYSTEM_API_KEY: z.string().min(32, 'AGENTIC_SYSTEM_API_KEY must contain at least 32 characters').optional(),
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
      `Set the missing values on the Railway dashboard service and redeploy.`
    );
  }
  cached = parsed.data;
  return cached;
}

/** Guards scheduled refresh routes with a bearer token. */
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
