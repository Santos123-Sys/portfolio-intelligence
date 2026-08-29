import { z } from 'zod';

const reasoningEffort = z.enum(['none', 'low', 'medium', 'high', 'xhigh']);

const commonSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  AGENTIC_DATABASE_URL: z.string().url(),
  AGENTIC_SYSTEM_API_KEY: z.string().min(32),
  AGENTIC_BUCKET_NAME: z.string().min(1).optional(),
  AGENTIC_BUCKET_ENDPOINT: z.string().url().optional(),
  AGENTIC_BUCKET_REGION: z.string().min(1).default('auto'),
  AGENTIC_BUCKET_ACCESS_KEY_ID: z.string().min(1).optional(),
  AGENTIC_BUCKET_SECRET_ACCESS_KEY: z.string().min(1).optional(),
});

const apiSchema = commonSchema.extend({
  PORT: z.coerce.number().int().positive().default(3001),
  AGENTIC_INTERNAL_BASE_URL: z.string().url().optional(),
});

const workerSchema = commonSchema.extend({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default('gpt-5.6'),
  OPENAI_REASONING_EFFORT: reasoningEffort.default('medium'),
  // Per-stage overrides. Unset means "use OPENAI_REASONING_EFFORT". The four
  // agents do not benefit equally from reasoning depth: extraction is close to
  // transcription and is forbidden from inferring anything, while discovery
  // and analysis carry the judgement. One global setting either underpowers
  // those two or overpays on extraction.
  OPENAI_REASONING_EFFORT_EXTRACTION: reasoningEffort.optional(),
  OPENAI_REASONING_EFFORT_ANALYSIS: reasoningEffort.optional(),
  OPENAI_REASONING_EFFORT_SYNTHESIS: reasoningEffort.optional(),
  OPENAI_REASONING_EFFORT_DISCOVERY: reasoningEffort.optional(),
  DASHBOARD_IMPORT_URL: z.string().url(),
  AGENTIC_WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
  AGENTIC_JOB_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  AGENTIC_CALLBACK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
  AGENTIC_INTERNAL_BASE_URL: z.string().url().optional(),
});

export type ApiConfig = z.infer<typeof apiSchema>;
export type WorkerConfig = z.infer<typeof workerSchema>;

function formatError(error: z.ZodError): Error {
  const fields = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  return new Error(`Agentic service environment validation failed: ${fields}`);
}

export function getApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = apiSchema.safeParse(normalizeBucketVariables(env));
  if (!parsed.success) throw formatError(parsed.error);
  validateBucketConfiguration(parsed.data);
  return parsed.data;
}

export function getWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = workerSchema.safeParse(normalizeBucketVariables(env));
  if (!parsed.success) throw formatError(parsed.error);
  validateBucketConfiguration(parsed.data);
  return parsed.data;
}

function normalizeBucketVariables(env: NodeJS.ProcessEnv) {
  const optional = (value: string | undefined) => value?.trim() || undefined;
  return {
    ...env,
    AGENTIC_BUCKET_NAME: optional(env.AGENTIC_BUCKET_NAME) ?? optional(env.BUCKET),
    AGENTIC_BUCKET_ENDPOINT: optional(env.AGENTIC_BUCKET_ENDPOINT) ?? optional(env.ENDPOINT),
    AGENTIC_BUCKET_ACCESS_KEY_ID: optional(env.AGENTIC_BUCKET_ACCESS_KEY_ID) ?? optional(env.ACCESS_KEY_ID),
    AGENTIC_BUCKET_SECRET_ACCESS_KEY: optional(env.AGENTIC_BUCKET_SECRET_ACCESS_KEY) ?? optional(env.SECRET_ACCESS_KEY),
  };
}

function validateBucketConfiguration(config: z.infer<typeof commonSchema>): void {
  const bucketFields = [
    config.AGENTIC_BUCKET_NAME,
    config.AGENTIC_BUCKET_ENDPOINT,
    config.AGENTIC_BUCKET_ACCESS_KEY_ID,
    config.AGENTIC_BUCKET_SECRET_ACCESS_KEY,
  ];
  const configured = bucketFields.filter(Boolean).length;
  if (configured !== 0 && configured !== bucketFields.length) {
    throw new Error('All AGENTIC_BUCKET_* credentials must be configured together');
  }
  if (config.NODE_ENV === 'production' && configured === 0) {
    throw new Error('Railway bucket credentials are required in production');
  }
}

/**
 * Collapses the global effort and its per-stage overrides into the map the
 * pipeline takes. Keeping this next to the schema means the env contract and
 * its interpretation cannot drift apart.
 */
export function stageReasoningEffort(config: WorkerConfig) {
  return {
    extraction: config.OPENAI_REASONING_EFFORT_EXTRACTION ?? config.OPENAI_REASONING_EFFORT,
    analysis: config.OPENAI_REASONING_EFFORT_ANALYSIS ?? config.OPENAI_REASONING_EFFORT,
    synthesis: config.OPENAI_REASONING_EFFORT_SYNTHESIS ?? config.OPENAI_REASONING_EFFORT,
    discovery: config.OPENAI_REASONING_EFFORT_DISCOVERY ?? config.OPENAI_REASONING_EFFORT,
  };
}
