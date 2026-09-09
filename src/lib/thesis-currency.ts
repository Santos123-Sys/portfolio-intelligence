import type { ThesisCriteria } from '@portfolio-intelligence/agentic-contract';

/**
 * A thesis can intentionally leave a currency unstated. Treat that as a
 * source-level absence of a restriction, not as a value that can conflict
 * with the portfolio's native currency. Older extraction results sometimes
 * contain a human-readable explanation in this field; normalize those too.
 */
const UNSPECIFIED_PATTERNS = /\b(?:not\s+specified|unspecified|any|n\/?a)\b/i;

export function normalizeThesisMandateCurrency(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || UNSPECIFIED_PATTERNS.test(trimmed)) return 'Unspecified';
  return trimmed.toUpperCase();
}

export function isUnspecifiedThesisMandateCurrency(value: string): boolean {
  return normalizeThesisMandateCurrency(value) === 'Unspecified';
}

/** Store a compact, user-readable currency mandate instead of provider prose. */
export function normalizeThesisCriteriaCurrencies(criteria: ThesisCriteria): ThesisCriteria {
  return {
    ...criteria,
    portfolios: criteria.portfolios.map((portfolio) => ({
      ...portfolio,
      currency: normalizeThesisMandateCurrency(portfolio.currency),
    })),
  };
}
