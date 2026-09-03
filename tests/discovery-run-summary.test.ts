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
    provider: 'finnhub', sourceUrl: 'https://finnhub.io/docs/api/stock-symbols', attributes: {},
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
    expect(summary.portfolioCandidateCounts).toEqual([
      { portfolioId: swissId, portfolioName: 'Swiss Quality', count: 6 },
      { portfolioId: brazilId, portfolioName: 'Brazilian Growth', count: 6 },
    ]);
  });

  it('retains the total when a legacy request cannot be parsed', () => {
    expect(summarizeDiscoveryCandidateCounts({}, [swissId, brazilId])).toEqual({
      candidateCount: 2,
      maxCandidatesPerPortfolio: null,
      portfolioCandidateCounts: [],
    });
  });
});
