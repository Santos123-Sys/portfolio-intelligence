import { describe, expect, it } from 'vitest';
import { portfoliosRequiredByThesis } from '../src/lib/thesis-portfolios';

describe('thesis portfolio containers', () => {
  it('creates the configured native-currency containers from eligible thesis mandates', () => {
    expect(portfoliosRequiredByThesis({
      version: 1,
      globalConstraints: [],
      portfolios: [
        { role: 'swiss_quality', currency: 'Unspecified', objective: 'Defensive compounding', inclusionCriteria: [], exclusionCriteria: [] },
        { role: 'brazilian_growth', currency: 'BRL', objective: 'Growth', inclusionCriteria: [], exclusionCriteria: [] },
      ],
    })).toEqual([
      { portfolioType: 'swiss_quality', name: 'Swiss Quality', baseCurrency: 'CHF', investmentObjective: 'Defensive compounding' },
      { portfolioType: 'brazilian_growth', name: 'Brazilian Growth', baseCurrency: 'BRL', investmentObjective: 'Growth' },
    ]);
  });

  it('does not create a generic container for a non-investable role', () => {
    expect(portfoliosRequiredByThesis({
      version: 1,
      globalConstraints: [],
      portfolios: [{ role: 'not_suitable', currency: 'USD', objective: 'Ignore', inclusionCriteria: [], exclusionCriteria: [] }],
    })).toEqual([]);
  });
});
