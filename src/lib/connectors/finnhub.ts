import type { Fundamentals, FundamentalsProvider } from './base';
import { passthroughGateway, type CallResult, type RequestGateway } from './gateway';

const ENDPOINT = '/api/v1/stock/metric';
const SOURCE_URL = 'https://finnhub.io/docs/api/company-basic-financials';
const EXCHANGE_SUFFIX: Record<string, string> = {
  XSWX: 'SW',
  BVMF: 'SA',
};

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function first(record: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) if (record[key] != null) return record[key];
  return null;
}

function symbolFor(ticker: string, exchange: string): string {
  const suffix = EXCHANGE_SUFFIX[exchange];
  if (!suffix) throw new Error(`Finnhub fundamentals exchange mapping is not configured for ${exchange}`);
  const clean = ticker.trim().toUpperCase().replace(/\.(SW|SA)$/i, '');
  return `${clean}.${suffix}`;
}

function percent(value: unknown): number | null {
  const parsed = finite(value);
  return parsed === null ? null : parsed / 100;
}

function latestPeriod(series: JsonRecord): string | null {
  const periods: string[] = [];
  for (const frequency of Object.values(series)) {
    for (const rows of Object.values(object(frequency))) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const period = object(row).period;
        if (typeof period === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(period)) periods.push(period);
      }
    }
  }
  return periods.sort().at(-1) ?? null;
}

function classifyFinnhubResponse(response: Response): CallResult {
  if (response.ok) return { outcome: 'ok', httpStatus: response.status };
  if (response.status === 402 || response.status === 403) return { outcome: 'plan_limit', httpStatus: response.status };
  if (response.status === 429) return { outcome: 'rate_limited', httpStatus: response.status };
  return { outcome: 'error', httpStatus: response.status };
}

export class FinnhubRequestError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? 'Finnhub rejected FINNHUB_API_KEY (HTTP 401). Check the dashboard service variable.'
        : `Finnhub basic-financials request failed with HTTP ${status}.`
    );
    this.name = 'FinnhubRequestError';
  }
}

/**
 * Low-cost fundamentals fallback for an EODHD plan that does not include the
 * fundamentals endpoint. It intentionally uses only Finnhub's documented
 * Basic Financials route; premium statements are not called or inferred.
 */
export class FinnhubFundamentalsProvider implements FundamentalsProvider {
  readonly name = 'finnhub';
  readonly supportedExchanges = Object.keys(EXCHANGE_SUFFIX);

  constructor(private readonly apiKey: string, private readonly gateway: RequestGateway = passthroughGateway) {
    if (!apiKey.trim()) throw new Error('FINNHUB_API_KEY is required for Finnhub fundamentals');
  }

  async getFundamentals(ticker: string, exchange: string): Promise<Fundamentals> {
    const symbol = symbolFor(ticker, exchange);
    const url = new URL(`https://finnhub.io${ENDPOINT}`);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('metric', 'all');
    url.searchParams.set('token', this.apiKey);

    const response = await this.gateway.run({
      provider: this.name,
      endpoint: ENDPOINT,
      perform: () => fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
        headers: { accept: 'application/json' },
      }),
      classify: classifyFinnhubResponse,
    });
    if (!response.ok) throw new FinnhubRequestError(response.status);

    const payload = object(await response.json());
    const metric = object(payload.metric);
    const out: Fundamentals = {
      _source: 'Finnhub Basic Financials',
      _sourceUrl: SOURCE_URL,
      _status: 'OK',
    };

    const asOf = latestPeriod(object(payload.series));
    if (asOf) out.data_as_of = asOf;

    const values: Array<[string, unknown, ((value: unknown) => number | null)?]> = [
      ['book_value_per_share', first(metric, 'bookValuePerShareAnnual', 'bookValuePerShareQuarterly')],
      ['cash_flow_per_share', first(metric, 'cashFlowPerShareAnnual', 'cashFlowPerShareTTM')],
      ['free_cash_flow_per_share', first(metric, 'freeCashFlowPerShareAnnual', 'freeCashFlowPerShareTTM')],
      ['earnings_per_share', first(metric, 'epsAnnual', 'epsTTM')],
      ['revenue_per_share', first(metric, 'revenuePerShareAnnual', 'revenuePerShareTTM')],
      ['pe_ratio', first(metric, 'peNormalizedAnnual', 'peAnnual', 'peTTM')],
      ['price_to_book', first(metric, 'pbAnnual', 'pbQuarterly')],
      ['dividend_yield', first(metric, 'currentDividendYieldTTM', 'dividendYieldIndicatedAnnual'), percent],
      ['profit_margin', first(metric, 'netProfitMarginAnnual', 'netProfitMarginTTM'), percent],
      ['gross_margin', first(metric, 'grossMarginAnnual', 'grossMarginTTM'), percent],
      ['operating_margin', first(metric, 'operatingMarginAnnual', 'operatingMarginTTM'), percent],
      ['return_on_equity', first(metric, 'roeAnnual', 'roeTTM'), percent],
      ['return_on_assets', first(metric, 'roaAnnual', 'roaTTM'), percent],
      ['revenue_growth_3y', first(metric, 'revenueGrowth3Y', 'revenueGrowthTTMYoy'), percent],
      ['debt_to_equity', first(metric, 'totalDebt/totalEquityAnnual', 'totalDebt/totalEquityQuarterly'), percent],
      ['current_ratio', first(metric, 'currentRatioAnnual', 'currentRatioQuarterly')],
      ['quick_ratio', first(metric, 'quickRatioAnnual', 'quickRatioQuarterly')],
      ['interest_coverage', first(metric, 'interestCoverageAnnual', 'interestCoverageTTM')],
      ['beta', first(metric, 'beta')],
      ['52_week_high', first(metric, '52WeekHigh')],
      ['52_week_low', first(metric, '52WeekLow')],
    ];
    for (const [key, raw, transform = finite] of values) {
      const value = transform(raw);
      if (value !== null) out[key] = value;
    }
    return out;
  }
}
