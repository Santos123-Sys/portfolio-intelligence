import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgenticHttpServer } from '../src/http-server.js';
import { hashManifest } from '../src/manifest.js';
import { MemoryRepository } from './memory-repository.js';
import { manifest, runRequest } from './fixtures.js';

const apiKey = 'agentic-test-key-12345678901234567890';

describe('agentic HTTP API', () => {
  const repository = new MemoryRepository();
  const storage = { get: async () => Buffer.from('%PDF-1.4\n%%EOF\n') };
  const server = createAgenticHttpServer({ repository, storage, apiKey });
  let baseUrl = '';

  beforeEach(async () => {
    repository.jobs.clear();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const authenticated = (init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...init.headers },
  });

  it('exposes a database-backed health check without exposing v1 endpoints', async () => {
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/v1/analysis-runs`)).status).toBe(401);
  });

  it('starts authenticated runs with unique immutable IDs and HTTP 202', async () => {
    const responses = await Promise.all([1, 2].map(() => fetch(`${baseUrl}/v1/analysis-runs`, authenticated({
      method: 'POST',
      body: JSON.stringify(runRequest),
    }))));
    expect(responses.every((response) => response.status === 202)).toBe(true);
    const bodies = await Promise.all(responses.map((response) => response.json())) as Array<{ externalRunId: string; status: string }>;
    expect(bodies[0].status).toBe('queued');
    expect(bodies[0].externalRunId).not.toBe(bodies[1].externalRunId);
  });

  it('rejects incoherent run coverage before persistence', async () => {
    const response = await fetch(`${baseUrl}/v1/analysis-runs`, authenticated({
      method: 'POST',
      body: JSON.stringify({ ...runRequest, groundingBundles: [] }),
    }));
    expect(response.status).toBe(400);
    expect(repository.jobs.size).toBe(0);
  });

  it('requires JSON and rejects active PDF content before persistence', async () => {
    const wrongType = await fetch(`${baseUrl}/v1/analysis-runs`, authenticated({
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(runRequest),
    }));
    expect(wrongType.status).toBe(415);

    const activePdf = Buffer.from('%PDF-1.4\n/OpenAction 1 0 R\n%%EOF').toString('base64');
    const response = await fetch(`${baseUrl}/v1/thesis-extractions`, authenticated({
      method: 'POST',
      body: JSON.stringify({
        document: {
          version: 1,
          fileName: 'active.pdf',
          mimeType: 'application/pdf',
          contentBase64: activePdf,
        },
      }),
    }));
    expect(response.status).toBe(400);
    expect(repository.jobs.size).toBe(0);
  });

  it('returns failed state and requeues the same logical run for retry', async () => {
    const created = await repository.create('analysis_run', 'agent-run-fixed', runRequest, 4);
    await repository.fail(created.id, 'analysis', 'Security analysis failed safely');
    const failed = await fetch(`${baseUrl}/v1/analysis-runs/agent-run-fixed`, authenticated());
    expect(await failed.json()).toMatchObject({
      externalRunId: 'agent-run-fixed',
      status: 'failed',
      errorMessage: 'Security analysis failed safely',
    });
    const retried = await fetch(`${baseUrl}/v1/analysis-runs/agent-run-fixed/retry`, authenticated({ method: 'POST' }));
    expect(retried.status).toBe(202);
    expect(await retried.json()).toMatchObject({ externalRunId: 'agent-run-fixed', status: 'queued' });
  });

  it('returns a completed manifest and streams the stored PDF', async () => {
    const created = await repository.create('analysis_run', 'agent-run-complete', runRequest, 4);
    await repository.completeAnalysis(created.id, manifest, hashManifest(manifest), {
      objectKey: 'reports/agent-run-complete.pdf',
      bytes: null,
    });
    const status = await fetch(`${baseUrl}/v1/analysis-runs/agent-run-complete`, authenticated());
    expect(await status.json()).toMatchObject({ status: 'completed', manifest });
    const report = await fetch(`${baseUrl}/v1/analysis-runs/agent-run-complete/report`, authenticated());
    expect(report.status).toBe(200);
    expect(report.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await report.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('queues thesis extraction without logging or returning raw document content', async () => {
    const source = 'Swiss quality companies only.';
    const response = await fetch(`${baseUrl}/v1/thesis-extractions`, authenticated({
      method: 'POST',
      body: JSON.stringify({
        document: {
          version: 2,
          fileName: 'thesis.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from(source).toString('base64'),
        },
      }),
    }));
    expect(response.status).toBe(202);
    expect(JSON.stringify(await response.json())).not.toContain(source);
  });
});
