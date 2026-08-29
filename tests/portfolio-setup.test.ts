import { describe, expect, it } from 'vitest';
import {
  assessAgenticReadiness,
  holdingCreateSchema,
  portfolioCreateSchema,
} from '../src/lib/portfolio-setup';

const portfolioId = '550e8400-e29b-41d4-a716-446655440000';

describe('portfolio setup input validation', () => {
  it('normalizes valid portfolio and position identifiers', () => {
    const portfolio = portfolioCreateSchema.parse({
      name: 'Swiss Quality',
      portfolioType: 'swiss_quality',
      baseCurrency: 'chf',
      investmentObjective: 'Stable long-term compounding',
    });
    const holding = holdingCreateSchema.parse({
      portfolioId,
      ticker: 'nesn',
      companyName: 'Nestlé S.A.',
      exchange: 'xswx',
      currency: 'chf',
      country: 'ch',
      quantity: '12.5',
      avgCost: '91.20',
    });

    expect(portfolio.baseCurrency).toBe('CHF');
    expect(holding).toMatchObject({ ticker: 'NESN', exchange: 'XSWX', currency: 'CHF', country: 'CH' });
    expect(holding.quantity).toBe(12.5);
  });

  it('rejects unknown roles, malformed market codes and invalid quantities', () => {
    expect(portfolioCreateSchema.safeParse({
      name: 'Unknown', portfolioType: 'manager_choice', baseCurrency: 'USD', investmentObjective: 'Test',
    }).success).toBe(false);
    expect(holdingCreateSchema.safeParse({
      portfolioId,
      ticker: 'BAD TICKER',
      companyName: 'Bad Security',
      exchange: 'NYSE',
      currency: 'US',
      quantity: 0,
      avgCost: -1,
    }).success).toBe(false);
  });

  it('rejects fields outside the mutation contract', () => {
    expect(portfolioCreateSchema.safeParse({
      name: 'Swiss Quality',
      portfolioType: 'swiss_quality',
      baseCurrency: 'CHF',
      investmentObjective: 'Stable compounding',
      ownerId: portfolioId,
    }).success).toBe(false);
  });
});

describe('agentic analysis readiness', () => {
  it('reports every missing prerequisite', () => {
    expect(assessAgenticReadiness({
      thesisVersion: null,
      portfolios: [],
      positionPortfolioIds: [],
    })).toEqual({
      ready: false,
      thesisVersion: null,
      portfolioCount: 0,
      positionCount: 0,
      issues: ['Confirm an investment thesis.', 'Create at least one portfolio.'],
    });
  });

  it('requires a holding in every configured portfolio', () => {
    const result = assessAgenticReadiness({
      thesisVersion: 1,
      portfolios: [
        { id: portfolioId, name: 'Swiss Quality' },
        { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', name: 'Fixed Income' },
      ],
      positionPortfolioIds: [portfolioId],
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toEqual(['Add a position to Fixed Income.']);
  });

  it('enables analysis when thesis, portfolios and holdings are complete', () => {
    const result = assessAgenticReadiness({
      thesisVersion: 2,
      portfolios: [{ id: portfolioId, name: 'Swiss Quality' }],
      positionPortfolioIds: [portfolioId, portfolioId],
    });
    expect(result).toMatchObject({ ready: true, thesisVersion: 2, portfolioCount: 1, positionCount: 2, issues: [] });
  });
});
