import { describe, expect, it } from 'vitest';
import { scoreDiscoveryEvidence } from '../src/lib/discovery-evidence';

describe('discovery evidence scorecards', () => {
  it('marks well-grounded research as sufficient', () => {
    const result = scoreDiscoveryEvidence({
      sourceUrls: ['https://example.com/a', 'https://example.com/b'],
      groundedIn: ['Annual report', 'Investor presentation'],
      informationGaps: ['Confirm peer forecasts'],
    }, { close: 100, currency: 'CHF', asOf: '2026-09-08', provider: 'eodhd', sourceUrl: null });
    expect(result.assessment).toBe('sufficient');
    expect(result.marketPriceStatus).toBe('available');
  });

  it('distinguishes useful but incomplete evidence from a research lead', () => {
    const developing = scoreDiscoveryEvidence({
      sourceUrls: ['https://example.com/a'],
      groundedIn: ['Company site'],
      informationGaps: ['Validate financial history', 'Validate peer set'],
    }, null);
    expect(developing.assessment).toBe('developing');
    expect(developing.marketPriceStatus).toBe('unavailable');

    const limited = scoreDiscoveryEvidence({ sourceUrls: [], groundedIn: [], informationGaps: [] }, null);
    expect(limited.assessment).toBe('limited');
  });
});
