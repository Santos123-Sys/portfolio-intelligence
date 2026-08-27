import { describe, expect, it } from 'vitest';
import { processJob } from '../src/process-job.js';
import { AgenticPipelineError } from '../src/openai-pipeline.js';
import { MemoryRepository } from './memory-repository.js';
import { analysis, grounding, portfolioId, runRequest, synthesis } from './fixtures.js';

const fakePdf = Buffer.from('%PDF-1.4\n%%EOF\n');

describe('durable job processing', () => {
  it('completes every requested analysis, synthesis, manifest and report before success', async () => {
    const repository = new MemoryRepository();
    const queued = await repository.create('analysis_run', 'agent-run-process', runRequest, 4);
    const job = (await repository.claimNext('worker-1', 300))!;
    const calls: string[] = [];
    await processJob(job, {
      repository,
      pipeline: {
        extractThesis: async () => { throw new Error('not used'); },
        analyzeSecurity: async (bundle) => { calls.push(`analysis:${bundle.ticker}`); return analysis; },
        synthesizePortfolio: async (portfolio) => { calls.push(`synthesis:${portfolio.id}`); return synthesis; },
      },
      storage: { put: async () => ({ objectKey: 'reports/agent-run-process.pdf', bytes: null }) },
      renderPdf: async () => fakePdf,
    });
    const completed = await repository.findByExternalId(queued.externalId);
    expect(completed?.status).toBe('completed');
    expect(completed?.result && 'portfolios' in completed.result && completed.result.portfolios[0].analyses)
      .toHaveLength(1);
    expect(completed?.callbackStatus).toBe('pending');
    expect(calls).toEqual(['analysis:NESN', `synthesis:${portfolioId}`]);
  });

  it('fails the whole run explicitly when one security analysis fails', async () => {
    const secondBundle = { ...grounding, ticker: 'ROG', companyName: 'Roche' };
    const request = {
      ...runRequest,
      securities: [...runRequest.securities, { ticker: 'ROG', exchange: 'XSWX', portfolioId }],
      groundingBundles: [...runRequest.groundingBundles, { portfolioId, bundle: secondBundle }],
    };
    const repository = new MemoryRepository();
    await repository.create('analysis_run', 'agent-run-partial', request, 5);
    const job = (await repository.claimNext('worker-1', 300))!;
    await processJob(job, {
      repository,
      pipeline: {
        extractThesis: async () => { throw new Error('not used'); },
        analyzeSecurity: async (bundle) => {
          if (bundle.ticker === 'ROG') throw new AgenticPipelineError('analysis', 'ROG analysis failed safely');
          return analysis;
        },
        synthesizePortfolio: async () => synthesis,
      },
      storage: { put: async () => ({ objectKey: null, bytes: fakePdf }) },
      renderPdf: async () => fakePdf,
    });
    const failed = await repository.findByExternalId('agent-run-partial');
    expect(failed).toMatchObject({ status: 'failed', failedStage: 'analysis', errorMessage: 'ROG analysis failed safely' });
    expect(failed?.result).toBeNull();
  });
});
