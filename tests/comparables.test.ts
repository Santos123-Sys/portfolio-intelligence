import { describe, expect, it } from 'vitest';
import { comparableCompanyAnalysis } from '../src/lib/quant/comparables';

const peers = Array.from({ length: 6 }, (_, index) => ({
  companyName: `Peer ${index + 1}`,
  ticker: `P${index + 1}`,
  marketCapitalization: 100 + index * 10,
  netDebt: 20,
  revenue: 40 + index,
  ebitda: 10 + index,
  netIncome: 6 + index,
  sourceUrl: `https://example.com/peer-${index + 1}`,
}));

describe('deterministic comparable-company analysis', () => {
  it('calculates peer multiples, statistics, outlier checks, and implied values', () => {
    const result = comparableCompanyAnalysis({
      companyName: 'Target', currency: 'CHF', revenue: 50, ebitda: 12, netIncome: 8, netDebt: 10, sharesOutstanding: 5,
    }, peers);
    expect(result.method).toBe('comparable_companies');
    expect(result.peers).toHaveLength(6);
    expect(result.peers[0].enterpriseValue).toBe(120);
    expect(result.statistics.evRevenue.count).toBe(6);
    expect(result.impliedValuations.some((value) => value.multiple === 'EV / EBITDA' && value.statistic === 'Median')).toBe(true);
  });

  it('requires a reviewable peer set of six to ten companies', () => {
    expect(() => comparableCompanyAnalysis({ companyName: 'Target', currency: 'CHF', revenue: 50 }, peers.slice(0, 5)))
      .toThrow(/6 to 10 peers/);
  });
});
