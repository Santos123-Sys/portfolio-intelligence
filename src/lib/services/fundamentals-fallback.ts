import type { Fundamentals, FundamentalsProvider, FundamentalsRequestOptions, PriceProvider } from '../connectors/base';
import { isEodhdPlanLimitError } from '../connectors/eodhd';

export const MINIMUM_NUMERIC_FUNDAMENTALS = 3;

const FINANCIAL_METRICS = new Set([
  'book_value_per_share',
  'cash_flow_per_share',
  'free_cash_flow_per_share',
  'earnings_per_share',
  'revenue_per_share',
  'pe_ratio',
  'price_to_book',
  'dividend_yield',
  'profit_margin',
  'gross_margin',
  'operating_margin',
  'return_on_equity',
  'return_on_assets',
  'revenue_growth_3y',
  'debt_to_equity',
  'current_ratio',
  'quick_ratio',
  'interest_coverage',
]);

export function numericFundamentalCount(fundamentals: Fundamentals): number {
  return Object.entries(fundamentals).filter(([key, value]) =>
    FINANCIAL_METRICS.has(key) && typeof value === 'number' && Number.isFinite(value)
  ).length;
}

function assertSufficient(fundamentals: Fundamentals, provider: string): void {
  const count = numericFundamentalCount(fundamentals);
  if (count < MINIMUM_NUMERIC_FUNDAMENTALS) {
    throw new Error(
      `${provider} supplied only ${count} usable numeric fundamental metrics; ` +
      `at least ${MINIMUM_NUMERIC_FUNDAMENTALS} are required to start financial analysis.`
    );
  }
}

async function loadFallback(
  fallback: FundamentalsProvider | null,
  ticker: string,
  exchange: string,
  reason: 'primary_plan_limit' | 'primary_data_insufficient'
) {
  if (!fallback) {
    throw new Error(
      'EODHD fundamentals are unavailable and the Finnhub fallback is not configured. ' +
      'Set DISCOVERY_PROVIDER=finnhub and FINNHUB_API_KEY on the dashboard service.'
    );
  }
  const fundamentals = await fallback.getFundamentals(ticker, exchange);
  assertSufficient(fundamentals, fallback.name);
  return { fundamentals, provider: fallback.name, usedFallback: true as const, reason };
}

/**
 * Preserve EODHD as primary validation, but route around a plan entitlement or
 * an empty fundamentals payload. Authentication, network, parsing and budget
 * failures still surface rather than being silently hidden by another vendor.
 */
export async function loadFundamentalsWithFallback(input: {
  primary: PriceProvider;
  fallback: FundamentalsProvider | null;
  ticker: string;
  exchange: string;
  primaryOptions?: FundamentalsRequestOptions;
}) {
  const { primary, fallback, ticker, exchange, primaryOptions } = input;
  if (!primary.getFundamentals) {
    throw new Error(`The configured ${primary.name} provider does not supply fundamentals`);
  }

  let fundamentals: Fundamentals;
  try {
    fundamentals = await primary.getFundamentals(ticker, exchange, primaryOptions);
  } catch (error) {
    if (primary.name !== 'eodhd' || !isEodhdPlanLimitError(error)) throw error;
    return loadFallback(fallback, ticker, exchange, 'primary_plan_limit');
  }

  if (numericFundamentalCount(fundamentals) < MINIMUM_NUMERIC_FUNDAMENTALS) {
    return loadFallback(fallback, ticker, exchange, 'primary_data_insufficient');
  }
  return { fundamentals, provider: primary.name, usedFallback: false as const, reason: null };
}
