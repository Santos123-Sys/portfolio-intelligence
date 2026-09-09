import { describe, expect, it } from 'vitest';
import {
  isUnspecifiedThesisMandateCurrency,
  normalizeThesisCriteriaCurrencies,
  normalizeThesisMandateCurrency,
} from '../src/lib/thesis-currency';

describe('thesis currency normalization', () => {
  it('keeps an explicit ISO currency as an enforceable mandate', () => {
    expect(normalizeThesisMandateCurrency(' chf ')).toBe('CHF');
    expect(isUnspecifiedThesisMandateCurrency('CHF')).toBe(false);
  });

  it('treats source-level unspecified language as no currency restriction', () => {
    const legacyExplanation = 'CHF (intended; confirmed source value remains Unspecified pending correction and reconfirmation)';
    expect(normalizeThesisMandateCurrency(legacyExplanation)).toBe('Unspecified');
    expect(isUnspecifiedThesisMandateCurrency(legacyExplanation)).toBe(true);
  });

  it('persists a compact source mandate rather than explanatory prose', () => {
    const criteria = normalizeThesisCriteriaCurrencies({
      version: 1,
      globalConstraints: [],
      portfolios: [{
        role: 'swiss_quality',
        currency: 'not specified in the source document',
        objective: 'Quality',
        inclusionCriteria: [],
        exclusionCriteria: [],
      }],
    });
    expect(criteria.portfolios[0].currency).toBe('Unspecified');
  });
});
