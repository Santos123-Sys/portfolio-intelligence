import { randomUUID } from 'node:crypto';
import { callbackPayload, deliverCallback, nextCallbackTime } from './callback.js';
import { getWorkerConfig, stageReasoningEffort, workerHealthBudgets } from './config.js';
import { OpenAIAgenticPipeline } from './openai-pipeline.js';
import { PostgresJobRepository } from './postgres-repository.js';
import { processJob } from './process-job.js';
import { ReportStorage } from './storage.js';
import { createWorkerHealthServer, type WorkerHeartbeat, type WorkerState } from './worker-health.js';

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

// The healthcheck reads these; the loop is the only writer.
let state: WorkerState = 'starting';
let lastPollAt: number | null = null;
let jobsProcessed = 0;

const heartbeat = (): WorkerHeartbeat => ({ state, lastPollAt, jobsProcessed });
const healthServer = createWorkerHealthServer({
  workerId,
  heartbeat,
  ...workerHealthBudgets(config),
});

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

function closeHealthServer(): Promise<void> {
  return new Promise((resolve) => healthServer.close(() => resolve()));
}

async function run(): Promise<void> {
  await repository.ping();
  await new Promise<void>((resolve, reject) => {
    const failedToBind = (error: Error) => reject(error);
    healthServer.once('error', failedToBind);
    healthServer.listen(config.PORT, '0.0.0.0', () => {
      healthServer.off('error', failedToBind);
      healthServer.on('error', (error: Error) => {
        process.stderr.write(`Worker liveness server error: ${error.message}\n`);
      });
      resolve();
    });
  });
  process.stdout.write(
    `Agentic worker ${workerId} ready with model ${config.OPENAI_MODEL}, liveness on 0.0.0.0:${config.PORT}/health\n`
  );
  while (!stopping) {
    // Recorded before the work, not after, so a job that never returns shows up
    // as a stalled worker instead of freezing the last healthy timestamp.
    lastPollAt = Date.now();
    state = 'idle';
    if (await deliverNextCallback()) continue;
    const job = await repository.claimNext(workerId, config.AGENTIC_JOB_LEASE_SECONDS);
    if (job) {
      process.stdout.write(`Processing ${job.kind} ${job.externalId}\n`);
      state = 'processing';
      try {
        await processJob(job, { repository, pipeline, storage });
      } finally {
        state = 'idle';
        jobsProcessed += 1;
      }
      continue;
    }
    await delay(config.AGENTIC_WORKER_POLL_MS);
  }
  await closeHealthServer();
  await repository.close();
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

run().catch(async (error: unknown) => {
  process.stderr.write(`Agentic worker stopped: ${error instanceof Error ? error.message : String(error)}\n`);
  // Without this the listening socket would keep the event loop alive and the
  // process would hang instead of exiting non-zero for Railway to restart.
  await closeHealthServer();
  await repository.close().catch(() => undefined);
  process.exitCode = 1;
});
