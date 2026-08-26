import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { callbackPayload, deliverCallback, nextCallbackTime } from '../src/callback.js';
import { MemoryRepository } from './memory-repository.js';
import { manifest, runRequest } from './fixtures.js';

describe('dashboard callback delivery', () => {
  let server: ReturnType<typeof createServer> | null = null;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    server = null;
  });

  it('sends a completed payload with the service credential', async () => {
    let authorization = '';
    let body = '';
    server = createServer(async (request, response) => {
      authorization = request.headers.authorization ?? '';
      for await (const chunk of request) body += chunk;
      response.writeHead(201).end('{}');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    const repository = new MemoryRepository();
    const job = await repository.create('analysis_run', 'agent-run-callback', runRequest, 4);
    await repository.completeAnalysis(job.id, manifest, 'hash', { objectKey: 'report.pdf', bytes: null });
    const completed = await repository.findByExternalId(job.externalId);
    const payload = callbackPayload(completed!, 'http://agentic-system.railway.internal:3001');
    await deliverCallback(`http://127.0.0.1:${port}/import`, 'shared-secret', payload);

    expect(authorization).toBe('Bearer shared-secret');
    expect(JSON.parse(body)).toMatchObject({ externalRunId: job.externalId, status: 'completed', manifest });
  });

  it('builds a safe failed callback without a stack or provider payload', async () => {
    const repository = new MemoryRepository();
    const job = await repository.create('analysis_run', 'agent-run-failed', runRequest, 4);
    await repository.fail(job.id, 'analysis', 'Analysis failed for NESN');
    const failed = await repository.findByExternalId(job.externalId);
    expect(callbackPayload(failed!)).toEqual({
      externalRunId: 'agent-run-failed',
      status: 'failed',
      errorMessage: 'Analysis failed for NESN',
      failedStage: 'analysis',
    });
  });

  it('uses bounded exponential callback retry times', () => {
    const start = Date.parse('2026-08-26T00:00:00.000Z');
    expect(nextCallbackTime(1, start).getTime() - start).toBe(5_000);
    expect(nextCallbackTime(20, start).getTime() - start).toBe(10 * 60_000);
  });
});
