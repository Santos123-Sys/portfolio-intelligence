import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getWorkerConfig, workerHealthBudgets } from '../src/config.js';
import {
  createWorkerHealthServer,
  evaluateWorkerHealth,
  type WorkerHeartbeat,
} from '../src/worker-health.js';

const budgets = { idleBudgetMs: 60_000, busyBudgetMs: 300_000 };
const beat = (overrides: Partial<WorkerHeartbeat> = {}): WorkerHeartbeat => ({
  state: 'idle',
  lastPollAt: 1_000_000,
  jobsProcessed: 3,
  ...overrides,
});

describe('worker liveness rule', () => {
  it('is unhealthy until the first poll completes', () => {
    expect(evaluateWorkerHealth(beat({ state: 'starting', lastPollAt: null }), budgets, 1_000_000))
      .toMatchObject({ healthy: false, status: 'starting' });
  });

  it('is healthy while the loop keeps polling', () => {
    expect(evaluateWorkerHealth(beat(), budgets, 1_000_000 + 5_000))
      .toMatchObject({ healthy: true, status: 'ok', jobsProcessed: 3 });
  });

  it('reports a wedged idle loop rather than staying online forever', () => {
    const report = evaluateWorkerHealth(beat(), budgets, 1_000_000 + 61_000);
    expect(report).toMatchObject({ healthy: false, status: 'stalled' });
    expect(report.detail).toMatch(/has not polled the queue for 61s/);
  });

  it('gives a running job the whole lease before calling it stalled', () => {
    const processing = beat({ state: 'processing' });
    expect(evaluateWorkerHealth(processing, budgets, 1_000_000 + 299_000).healthy).toBe(true);
    const stalled = evaluateWorkerHealth(processing, budgets, 1_000_000 + 301_000);
    expect(stalled).toMatchObject({ healthy: false, status: 'stalled' });
    expect(stalled.detail).toMatch(/inside one job for 301s/);
  });
});

describe('worker liveness endpoint', () => {
  let heartbeat: WorkerHeartbeat = beat();
  let now = 1_000_000;
  const server = createWorkerHealthServer({
    workerId: 'worker-test',
    heartbeat: () => heartbeat,
    now: () => now,
    ...budgets,
  });
  let baseUrl = '';

  beforeEach(async () => {
    heartbeat = beat();
    now = 1_000_000;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it('answers 200 while polling and 503 once stalled', async () => {
    const healthy = await fetch(`${baseUrl}/health`);
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({
      status: 'ok',
      workerId: 'worker-test',
      state: 'idle',
      secondsSinceLastPoll: 0,
      jobsProcessed: 3,
    });

    now += 120_000;
    const stalled = await fetch(`${baseUrl}/health`);
    expect(stalled.status).toBe(503);
    expect(await stalled.json()).toMatchObject({ status: 'stalled', secondsSinceLastPoll: 120 });
  });

  it('exposes nothing but the liveness path', async () => {
    expect((await fetch(`${baseUrl}/`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/v1/analysis-runs`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/health`, { method: 'POST' })).status).toBe(404);
  });
});

describe('worker liveness budgets', () => {
  const env = {
    NODE_ENV: 'test',
    AGENTIC_DATABASE_URL: 'postgresql://agentic:agentic@localhost:5432/agentic',
    AGENTIC_SYSTEM_API_KEY: '12345678901234567890123456789012',
    OPENAI_API_KEY: 'openai-test-key',
    DASHBOARD_IMPORT_URL: 'http://dashboard.railway.internal:3000/api/integrations/agentic/import',
  };

  it('derives the busy budget from the job lease and defaults the worker to its own port', () => {
    const config = getWorkerConfig(env);
    expect(config.PORT).toBe(3002);
    expect(workerHealthBudgets(config)).toEqual({ idleBudgetMs: 60_000, busyBudgetMs: 300_000 });
  });

  it('widens the idle budget so a slow poll interval cannot flap the healthcheck', () => {
    const config = getWorkerConfig({ ...env, AGENTIC_WORKER_POLL_MS: '30000' });
    expect(workerHealthBudgets(config).idleBudgetMs).toBe(150_000);
  });
});
