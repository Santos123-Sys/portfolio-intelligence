import { describe, expect, it } from 'vitest';
import { summarizeDiscoveryUniverse } from '../src/lib/discovery-universe-summary';

describe('discovery universe provenance', () => {
  it('reports selection limits and oldest source snapshot for each market', () => {
    const base = {
      exchange: 'XSWX', companyName: 'Example', currency: 'CHF', country: 'Switzerland',
      sector: null, industry: null, assetType: 'Listed Equity', provider: 'finnhub',
      sourceUrl: 'https://example.org/source',
      attributes: { universe_ranking: 'alphabetically_stratified_unranked', universe_truncated: true, universe_eligible_count: 200 },
    };
    const result = summarizeDiscoveryUniverse([
      { ...base, ticker: 'AAA', observedAt: '2026-09-23T12:00:00.000Z' },
      { ...base, ticker: 'ZZZ', observedAt: '2026-09-22T12:00:00.000Z' },
    ]);
    expect(result).toMatchObject([{ count: 2, eligibleCount: 200, limited: true, observedAt: '2026-09-22T12:00:00.000Z' }]);
    expect(result[0].selection).toContain('size was unavailable');
  });
});
