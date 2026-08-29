import { describe, expect, it } from 'vitest';
import { processJob } from '../src/process-job.js';
import { AgenticPipelineError } from '../src/openai-pipeline.js';
import { MemoryRepository } from './memory-repository.js';
import { analysis, grounding, portfolioId, runRequest, synthesis } from './fixtures.js';
import type { DiscoveryRunRequest, MarketDiscoveryOutput } from '@portfolio-intelligence/agentic-contract';

const fakePdf = Buffer.from('%PDF-1.4\n%%EOF\n');

describe('durable job processing', () => {
  it('persists a provider-grounded market discovery result without rendering a report', async () => {
    const repository = new MemoryRepository();
    const request: DiscoveryRunRequest = {
      thesis: runRequest.thesis,
      portfolios: [{
        id: portfolioId,
        name: 'Swiss Quality',
        role: 'swiss_quality',
        baseCurrency: 'CHF',
        investmentObjective: 'Durable compounding',
      }],
      universe: [{
        ticker: 'NESN',
        exchange: 'XSWX',
        companyName: 'Nestle SA',
        currency: 'CHF',
        country: 'Switzerland',
        sector: 'Consumer Defensive',
        industry: 'Packaged Foods',
        assetType: 'Listed Equity',
        observedAt: '2026-08-29T12:00:00.000Z',
        provider: 'eodhd',
        sourceUrl: 'https://eodhd.com/financial-apis/stock-market-screener-api',
        attributes: { dividend_yield: 0.03 },
      }],
      maxCandidatesPerPortfolio: 5,
    };
    const result: MarketDiscoveryOutput = {
      thesisVersion: request.thesis.criteria.version,
      marketMandates: [{
        portfolioId,
        role: 'swiss_quality',
        exchanges: ['XSWX'],
        currency: 'CHF',
        rationale: 'Matches the confirmed Swiss-quality mandate.',
      }],
      candidates: [{
        portfolioId,
        ticker: 'NESN',
        exchange: 'XSWX',
        companyName: 'Nestle SA',
        currency: 'CHF',
        country: 'Switzerland',
        sector: 'Consumer Defensive',
        thesisAlignmentScore: 80,
        rationale: 'Provider evidence supports initial review.',
        matchedCriteria: ['Swiss listing'],
        violatedCriteria: [],
        groundedIn: ['identity:exchange', 'attribute:dividend_yield'],
        sourceUrls: ['https://eodhd.com/financial-apis/stock-market-screener-api'],
        informationGaps: ['Recurring cash flow is not in screener data'],
      }],
      verifiedWebSources: [],
      limitations: ['Bounded provider universe'],
    };
    await repository.create('market_discovery', 'discovery-process', request, 1);
    const job = (await repository.claimNext('worker-1', 300))!;
    await processJob(job, {
      repository,
      pipeline: {
        extractThesis: async () => { throw new Error('not used'); },
        discoverSecurities: async () => result,
        analyzeSecurity: async () => { throw new Error('not used'); },
        synthesizePortfolio: async () => { throw new Error('not used'); },
      },
      storage: { put: async () => { throw new Error('not used'); } },
    });
    const completed = await repository.findByExternalId('discovery-process');
    expect(completed?.status).toBe('completed');
    expect(completed?.result).toEqual(result);
  });

  it('completes every requested analysis, synthesis, manifest and report before success', async () => {
    const repository = new MemoryRepository();
    const queued = await repository.create('analysis_run', 'agent-run-process', runRequest, 4);
    const job = (await repository.claimNext('worker-1', 300))!;
    const calls: string[] = [];
    await processJob(job, {
      repository,
      pipeline: {
        extractThesis: async () => { throw new Error('not used'); },
        discoverSecurities: async () => { throw new Error('not used'); },
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
        discoverSecurities: async () => { throw new Error('not used'); },
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
