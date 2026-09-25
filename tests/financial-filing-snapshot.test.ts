import { describe, expect, it } from 'vitest';
import { selectFilingSnapshot } from '../src/lib/financial-filing-snapshot';

const row = (metricName: string, observationDate: string, sourceUrl: string, currency = 'BRL') => ({
  metricName, observationDate, sourceUrl, currency, provider: 'investor-relations', retrievedAt: new Date('2026-09-25'),
});
const metrics = ['free_cash_flow', 'total_debt', 'cash_and_equivalents', 'shares_outstanding'];

describe('valuation filing snapshot', () => {
  it('does not fill missing current facts with prior-year or other-filing facts', () => {
    const prior = metrics.map((metric) => row(metric, '2024-12-31', 'https://issuer.test/2024'));
    const selected = selectFilingSnapshot([
      ...prior,
      row('free_cash_flow', '2025-12-31', 'https://issuer.test/2025'),
      row('total_debt', '2025-12-31', 'https://other.test/2025'),
      row('cash_and_equivalents', '2025-12-31', 'https://issuer.test/2025', 'USD'),
    ], 'BRL', metrics);
    expect([...selected.keys()]).toEqual(['free_cash_flow']);
  });

  it('accepts all required facts from one annual filing, with shares as a unitless count', () => {
    const selected = selectFilingSnapshot(metrics.map((metric) => row(metric, '2025-12-31', 'https://issuer.test/2025', metric === 'shares_outstanding' ? '' : 'BRL')), 'BRL', metrics);
    expect(selected.size).toBe(4);
  });
});
