/**
 * Environment validation. Fails loudly at startup, naming the missing key.
 *
 * This module keeps Railway/runtime configuration failures explicit rather than
 * allowing an undefined credential to fail deep inside a request.
 */
import { z } from 'zod';

const databaseUrlSchema = z.string().url('DATABASE_URL must be a valid Postgres connection string');

const schema = z.object({
  DATABASE_URL: databaseUrlSchema,
  MARKET_DATA_API_KEY: z.string().min(1).optional(),
  MARKET_DATA_PROVIDER: z.enum(['stub', 'stooq', 'twelvedata', 'eodhd', 'yahoo-search']).default('stub'),
  WEB_SEARCH_PROVIDER: z.enum(['none', 'brave']).default('none'),
  WEB_SEARCH_API_KEY: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must contain at least 32 characters'),
  /** Separate key used only to encrypt TOTP seeds and hash recovery codes. */
  MFA_ENCRYPTION_KEY: z.string().min(32, 'MFA_ENCRYPTION_KEY must contain at least 32 characters').optional(),
  /** Pins CSRF origin validation to the public dashboard origin when configured. */
  PUBLIC_APP_URL: z.string().url('PUBLIC_APP_URL must be a valid absolute URL').optional(),
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 chars').optional(),
  /** External Agentic System integration; the dashboard never owns its prompts. */
  AGENTIC_SYSTEM_BASE_URL: z.string().url().optional(),
  AGENTIC_SYSTEM_API_KEY: z.string().min(32, 'AGENTIC_SYSTEM_API_KEY must contain at least 32 characters').optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
}).superRefine((env, context) => {
  if (env.MARKET_DATA_PROVIDER === 'eodhd' && !env.MARKET_DATA_API_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MARKET_DATA_API_KEY'],
      message: 'MARKET_DATA_API_KEY is required when MARKET_DATA_PROVIDER=eodhd',
    });
  }
  if (Boolean(env.AGENTIC_SYSTEM_BASE_URL) !== Boolean(env.AGENTIC_SYSTEM_API_KEY)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AGENTIC_SYSTEM_BASE_URL'],
      message: 'AGENTIC_SYSTEM_BASE_URL and AGENTIC_SYSTEM_API_KEY must be configured together',
    });
  }
  if (env.NODE_ENV === 'production' && !env.PUBLIC_APP_URL?.startsWith('https://')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PUBLIC_APP_URL'],
      message: 'PUBLIC_APP_URL must be configured with an https:// origin in production',
    });
  }
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function validationFailure(issues: z.ZodIssue[]): Error {
  const missing = issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  return new Error(
    `Environment validation failed:\n${missing}\n\n` +
    `Set the missing values on the Railway dashboard service and redeploy.`
  );
}

/**
 * Database modules use this narrower validator so importing a route during a
 * framework build does not read unrelated runtime secrets. The value is still
 * required before the first query is created.
 */
export function getDatabaseUrl(): string {
  const parsed = databaseUrlSchema.safeParse(process.env.DATABASE_URL?.trim());
  if (!parsed.success) {
    throw validationFailure(parsed.error.issues.map((issue) => ({
      ...issue,
      path: ['DATABASE_URL', ...issue.path],
    })));
  }
  return parsed.data;
}

export function getEnv(): Env {
  if (cached) return cached;
  const optional = (value: string | undefined) => value?.trim() || undefined;
  const parsed = schema.safeParse({
    ...process.env,
    MARKET_DATA_API_KEY: optional(process.env.MARKET_DATA_API_KEY),
    WEB_SEARCH_API_KEY: optional(process.env.WEB_SEARCH_API_KEY),
    CRON_SECRET: optional(process.env.CRON_SECRET),
    AGENTIC_SYSTEM_BASE_URL: optional(process.env.AGENTIC_SYSTEM_BASE_URL),
    AGENTIC_SYSTEM_API_KEY: optional(process.env.AGENTIC_SYSTEM_API_KEY),
    MFA_ENCRYPTION_KEY: optional(process.env.MFA_ENCRYPTION_KEY),
    PUBLIC_APP_URL: optional(process.env.PUBLIC_APP_URL),
  });
  if (!parsed.success) {
    throw validationFailure(parsed.error.issues);
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
