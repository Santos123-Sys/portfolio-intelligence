import { describe, expect, it } from 'vitest';
import { summarizeDiscoveryCandidateCounts } from '../src/lib/discovery-run-summary';

const swissId = '11111111-1111-4111-8111-111111111111';
const brazilId = '22222222-2222-4222-8222-222222222222';

const request = {
  thesis: {
    versionId: '33333333-3333-4333-8333-333333333333',
    criteria: {
      version: 1,
      portfolios: [
        { role: 'swiss_quality', currency: 'CHF', objective: 'Quality', inclusionCriteria: [], exclusionCriteria: [] },
        { role: 'brazilian_growth', currency: 'BRL', objective: 'Growth', inclusionCriteria: [], exclusionCriteria: [] },
      ],
      globalConstraints: [],
    },
  },
  portfolios: [
    { id: swissId, name: 'Swiss Quality', role: 'swiss_quality', baseCurrency: 'CHF', investmentObjective: 'Quality' },
    { id: brazilId, name: 'Brazilian Growth', role: 'brazilian_growth', baseCurrency: 'BRL', investmentObjective: 'Growth' },
  ],
  universe: [{
    ticker: 'NESN', exchange: 'XSWX', companyName: 'Nestle', currency: 'CHF',
    country: 'Switzerland', sector: 'Consumer staples', industry: 'Food',
    assetType: 'Listed Equity', observedAt: '2026-09-03T00:00:00.000Z',
    provider: 'eodhd', sourceUrl: 'https://eodhd.com/financial-apis/exchanges-api-list-of-tickers-and-trading-hours', attributes: {
      universe_truncated: true, universe_ranking: 'unranked',
    },
  }],
  maxCandidatesPerPortfolio: 6,
};

describe('discovery run candidate summary', () => {
  it('distinguishes a valid combined total from each portfolio cap', () => {
    const summary = summarizeDiscoveryCandidateCounts(request, [
      ...Array<string>(6).fill(swissId),
      ...Array<string>(6).fill(brazilId),
    ]);

    expect(summary.candidateCount).toBe(12);
    expect(summary.maxCandidatesPerPortfolio).toBe(6);
    expect(summary.universeCoverage).toEqual({
      records: 1, truncated: true, unranked: true, providers: ['eodhd'],
      recordsByPortfolio: [{ portfolioId: swissId, count: 1 }, { portfolioId: brazilId, count: 0 }],
    });
    expect(summary.portfolioCandidateCounts).toEqual([
      { portfolioId: swissId, portfolioName: 'Swiss Quality', count: 6, status: 'pending', reason: 'Research has not completed for this portfolio.' },
      { portfolioId: brazilId, portfolioName: 'Brazilian Growth', count: 6, status: 'pending', reason: 'Research has not completed for this portfolio.' },
    ]);
  });

  it('retains the total when a legacy request cannot be parsed', () => {
    expect(summarizeDiscoveryCandidateCounts({}, [swissId, brazilId])).toEqual({
      candidateCount: 2,
      maxCandidatesPerPortfolio: null,
      portfolioCandidateCounts: [],
      universeCoverage: { records: 0, truncated: false, unranked: false, providers: [], recordsByPortfolio: [] },
    });
  });

  it('reports a failed market separately from a researched market with no matches', () => {
    const summary = summarizeDiscoveryCandidateCounts(request, [], {
      thesisVersion: 1,
      marketMandates: [
        { portfolioId: swissId, role: 'swiss_quality', exchanges: ['XSWX'], currency: 'CHF', rationale: 'Searched' },
        { portfolioId: brazilId, role: 'brazilian_growth', exchanges: ['BVMF'], currency: 'BRL', rationale: 'Failed' },
      ],
      candidates: [], verifiedWebSources: [], limitations: [],
      portfolioOutcomes: [
        { portfolioId: swissId, status: 'no_candidates', reason: 'No companies qualified.' },
        { portfolioId: brazilId, status: 'failed', reason: 'Provider timed out.' },
      ],
    });
    expect(summary.portfolioCandidateCounts.map(({ status, reason }) => ({ status, reason }))).toEqual([
      { status: 'no_candidates', reason: 'No companies qualified.' },
      { status: 'failed', reason: 'Provider timed out.' },
    ]);
  });
});
