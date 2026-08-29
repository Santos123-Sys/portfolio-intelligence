import { randomUUID } from 'node:crypto';
import { callbackPayload, deliverCallback, nextCallbackTime } from './callback.js';
import { getWorkerConfig, stageReasoningEffort } from './config.js';
import { OpenAIAgenticPipeline } from './openai-pipeline.js';
import { PostgresJobRepository } from './postgres-repository.js';
import { processJob } from './process-job.js';
import { ReportStorage } from './storage.js';

const config = getWorkerConfig();
const repository = new PostgresJobRepository(config.AGENTIC_DATABASE_URL);
const pipeline = new OpenAIAgenticPipeline(
  config.OPENAI_API_KEY,
  config.OPENAI_MODEL,
  stageReasoningEffort(config)
);
const storage = new ReportStorage(config);
const workerId = `worker-${randomUUID()}`;
let stopping = false;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function deliverNextCallback(): Promise<boolean> {
  const job = await repository.claimCallback();
  if (!job) return false;
  try {
    await deliverCallback(
      config.DASHBOARD_IMPORT_URL,
      config.AGENTIC_SYSTEM_API_KEY,
      callbackPayload(job, config.AGENTIC_INTERNAL_BASE_URL)
    );
    await repository.markCallbackDelivered(job.id);
  } catch (error) {
    const permanent = job.callbackAttempts >= config.AGENTIC_CALLBACK_MAX_ATTEMPTS;
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Dashboard callback failed';
    await repository.scheduleCallbackRetry(
      job.id,
      message,
      nextCallbackTime(job.callbackAttempts),
      permanent
    );
  }
  return true;
}

async function run(): Promise<void> {
  await repository.ping();
  process.stdout.write(`Agentic worker ${workerId} ready with model ${config.OPENAI_MODEL}\n`);
  while (!stopping) {
    if (await deliverNextCallback()) continue;
    const job = await repository.claimNext(workerId, config.AGENTIC_JOB_LEASE_SECONDS);
    if (job) {
      process.stdout.write(`Processing ${job.kind} ${job.externalId}\n`);
      await processJob(job, { repository, pipeline, storage });
      continue;
    }
    await delay(config.AGENTIC_WORKER_POLL_MS);
  }
  await repository.close();
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

run().catch(async (error: unknown) => {
  process.stderr.write(`Agentic worker stopped: ${error instanceof Error ? error.message : String(error)}\n`);
  await repository.close().catch(() => undefined);
  process.exitCode = 1;
});
