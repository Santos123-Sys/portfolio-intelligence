import type { SecurityUniverseRecord } from '@portfolio-intelligence/agentic-contract';
import type { DailyBar, Fundamentals, PriceProvider } from './base';

const SOURCE_URL = 'https://eodhd.com/financial-apis/stock-market-screener-api';
const FUNDAMENTALS_SOURCE_URL = 'https://eodhd.com/financial-apis/stock-etfs-fundamental-data-feeds';
const EXCHANGE_CODES: Record<string, { code: string; currency: string; country: string }> = {
  XSWX: { code: 'SW', currency: 'CHF', country: 'Switzerland' },
  BVMF: { code: 'SA', currency: 'BRL', country: 'Brazil' },
  XNYS: { code: 'US', currency: 'USD', country: 'United States' },
  XNAS: { code: 'US', currency: 'USD', country: 'United States' },
};

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function finite(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function first(record: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) if (record[key] != null) return record[key];
  return null;
}

function exchangeInfo(mic: string) {
  const info = EXCHANGE_CODES[mic];
  if (!info) throw new Error(`EODHD exchange mapping is not configured for ${mic}`);
  return info;
}

function normalizedTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\.(SW|SA|US)$/i, '');
}

function latestStatement(section: unknown): JsonRecord {
  const rows = Object.values(object(section)).filter((value) => value && typeof value === 'object') as JsonRecord[];
  return rows.sort((a, b) => String(first(b, 'date', 'filing_date')).localeCompare(String(first(a, 'date', 'filing_date'))))[0] ?? {};
}

/**
 * EODHD gates endpoints separately, so the same working token can succeed on
 * one path and 403 on another. A bare "request failed with HTTP 403" sends
 * whoever reads it hunting for a broken key, when the usual cause is that the
 * plan does not include that endpoint — a subscription question no code
 * change can answer.
 *
 * This was learned the slow way: EOD prices for SIX and B3 returned real
 * closes on a key whose /api/screener call 403'd in the same minute. The
 * message now carries that distinction so the next reader starts in the right
 * place. The token is never echoed — it travels in the query string and this
 * text reaches the browser.
 */
export function describeEodhdFailure(path: string, status: number): string {
  const endpoint = path.startsWith('/api/screener')
    ? 'the Screener API (/api/screener), which stock discovery needs'
    : path.startsWith('/api/eod')
      ? 'end-of-day prices (/api/eod)'
      : path.startsWith('/api/fundamentals')
        ? 'fundamentals (/api/fundamentals)'
        : `${path}`;

  if (status === 403) {
    return (
      `EODHD returned 403 for ${endpoint}. A 403 means the token was accepted but ` +
      `your plan does not include this endpoint or exchange — it is not a broken key. ` +
      `Confirm what the key can reach with: npm run verify:provider eodhd. If that ` +
      `passes, the key is fine and this endpoint needs adding to your EODHD subscription.`
    );
  }
  if (status === 401) {
    return (
      `EODHD rejected the token (401) for ${endpoint}. Check MARKET_DATA_API_KEY on the ` +
      `dashboard service, including for stray surrounding quotes — Railway stores values ` +
      `verbatim, and a quoted key passes validation but is sent to EODHD with the quotes.`
    );
  }
  if (status === 423 || status === 402) {
    return (
      `EODHD returned ${status} for ${endpoint}, which this API uses to mean the endpoint ` +
      `is not included in your plan. The token itself is fine — confirm with: ` +
      `npm run verify:provider eodhd.`
    );
  }
  if (status === 429) {
    return `EODHD rate limit reached (429) for ${endpoint}. Safe to retry after a delay.`;
  }
  if (status >= 500) {
    return `EODHD returned a server error (${status}) for ${endpoint}. Safe to retry.`;
  }
  return `EODHD request for ${endpoint} failed with HTTP ${status}.`;
}

/**
 * Asset types excluded from a discovery universe.
 *
 * Deliberately an exclusion list rather than an allow-list of "Common Stock":
 * PETR4, one of the largest names on B3, is a *preferred* share, and half of
 * the Brazilian market is units and preferreds. Allow-listing common stock
 * only would silently delete the B3 large caps this system exists to analyse.
 */
const EXCLUDED_ASSET_TYPES = ['etf', 'fund', 'bond', 'index', 'currency', 'note', 'warrant', 'right'];

function isTradableEquityType(assetType: string): boolean {
  const lowered = assetType.toLowerCase();
  return !EXCLUDED_ASSET_TYPES.some((excluded) => lowered.includes(excluded));
}

/**
 * Carries the HTTP status so callers can branch on it without parsing prose.
 * The message stays human-facing; the status stays machine-facing.
 */
export class EodhdRequestError extends Error {
  constructor(readonly status: number, readonly endpoint: string, message: string) {
    super(message);
    this.name = 'EodhdRequestError';
  }
}

/**
 * Statuses that mean "the token is fine, this endpoint is not on your plan".
 *
 * 403 is the documented one. 423 is not documented anywhere by EODHD, but it
 * is what /api/eod-bulk-last-day actually returns on a Basic plan whose
 * /api/eod and /api/exchange-symbol-list calls both return 200 — measured, not
 * assumed. 402 is included because it is the conventional payment-required
 * signal and would mean the same thing here.
 *
 * 401 is deliberately absent: that is a rejected token, a real fault, and must
 * surface rather than be quietly routed around.
 */
const PLAN_LIMIT_STATUSES = new Set([402, 403, 423]);

function isPlanLimit(error: unknown): boolean {
  return error instanceof EodhdRequestError && PLAN_LIMIT_STATUSES.has(error.status);
}

export class EodhdProvider implements PriceProvider {
  readonly name = 'eodhd';
  readonly supportedExchanges = Object.keys(EXCHANGE_CODES);

  constructor(private readonly apiKey: string) {
    if (!apiKey.trim()) throw new Error('MARKET_DATA_API_KEY is required for EODHD');
  }

  private async request(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(path, 'https://eodhd.com');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('api_token', this.apiKey);
    url.searchParams.set('fmt', 'json');
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new EodhdRequestError(response.status, path, describeEodhdFailure(path, response.status));
    }
    return response.json();
  }

  /**
   * Builds the discovery universe, preferring the richest source the plan allows.
   *
   *   1. /api/screener            ranked by market capitalisation. Best, but it
   *                               is an All-World-Extended / All-In-One feature
   *                               and 403s on smaller plans.
   *   2. /api/exchange-symbol-list ships with every plan including the free tier.
   *      + /api/eod-bulk-last-day  one extra call for last close and volume, so
   *                               the list can be ranked by turnover instead of
   *                               arbitrarily truncated.
   *   3. /api/exchange-symbol-list alone, unranked, with the limitation recorded
   *                               on each record so the agent must disclose it.
   *
   * Why the ranking in step 2 is not optional: the symbol list carries no size
   * field, and an exchange list truncated alphabetically drops Nestlé, Novartis,
   * Roche and UBS off a Swiss universe while keeping every company beginning
   * with A. That is worse than useless for a quality thesis, and it would fail
   * silently — the run would look successful and simply never consider the
   * large caps. Turnover (close x volume) is a coarse proxy for size, but it is
   * a real, provider-supplied number and it keeps the large caps in.
   */
  async getSecurityUniverse(exchange: string, limit: number): Promise<SecurityUniverseRecord[]> {
    try {
      return await this.screenerUniverse(exchange, limit);
    } catch (error) {
      if (!isPlanLimit(error)) throw error;
    }
    return this.symbolListUniverse(exchange, limit);
  }

  /**
   * Last close and volume for an entire exchange in one call, keyed by symbol.
   * Returns an empty map when the plan does not carry the bulk endpoint, which
   * degrades the universe to unranked rather than failing the run.
   */
  private async exchangeTurnover(exchangeCode: string): Promise<Map<string, { turnover: number; date: string }>> {
    const turnover = new Map<string, { turnover: number; date: string }>();
    let payload: unknown;
    try {
      payload = await this.request(`/api/eod-bulk-last-day/${encodeURIComponent(exchangeCode)}`, {});
    } catch {
      // Best-effort by design, and the reason is worth stating: ranking is an
      // enhancement, the symbol list is the requirement. An earlier version
      // rethrew anything that was not a 403, which meant a single unavailable
      // optional endpoint took the whole universe down with it — discovery
      // would have failed on a plan where it could have worked. Whatever went
      // wrong here, an unranked universe beats no universe, and the
      // degradation is not silent: every record carries
      // universe_ranking: 'unranked' for the agent to disclose.
      return turnover;
    }
    if (!Array.isArray(payload)) return turnover;
    for (const value of payload) {
      const row = object(value);
      const code = text(first(row, 'code', 'Code'));
      const close = finite(first(row, 'adjusted_close', 'close'));
      const volume = finite(first(row, 'volume'));
      const date = text(first(row, 'date'));
      if (!code || close === null || volume === null || close <= 0 || volume <= 0) continue;
      turnover.set(code.toUpperCase(), { turnover: close * volume, date: date ?? '' });
    }
    return turnover;
  }

  private async symbolListUniverse(exchange: string, limit: number): Promise<SecurityUniverseRecord[]> {
    const info = exchangeInfo(exchange);
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const endpoint = `/api/exchange-symbol-list/${encodeURIComponent(info.code)}`;
    const payload = await this.request(endpoint, {});
    const rows = Array.isArray(payload) ? payload : [];
    const turnover = await this.exchangeTurnover(info.code);
    const ranked = turnover.size > 0;
    const observedAt = new Date().toISOString();
    const sourceUrl = `https://eodhd.com${endpoint}`;

    const candidates = rows.flatMap((value) => {
      const row = object(value);
      const code = text(first(row, 'Code', 'code'));
      const companyName = text(first(row, 'Name', 'name'));
      const assetType = text(first(row, 'Type', 'type')) ?? 'Common Stock';
      if (!code || !companyName || !isTradableEquityType(assetType)) return [];
      const liquidity = turnover.get(code.toUpperCase());
      return [{ code, companyName, assetType, row, liquidity }];
    });

    // Descending turnover keeps the large caps; the tiebreak keeps the order
    // deterministic so two runs on the same day produce the same universe.
    candidates.sort((a, b) =>
      (b.liquidity?.turnover ?? 0) - (a.liquidity?.turnover ?? 0) || a.code.localeCompare(b.code)
    );

    const truncated = candidates.length > boundedLimit;
    return candidates.slice(0, boundedLimit).map(({ code, companyName, assetType, row, liquidity }) => {
      const attributes: SecurityUniverseRecord['attributes'] = {
        // Provenance the agent can cite, and must be able to, because this
        // universe is a subset chosen by a rule it did not choose.
        universe_source: 'exchange-symbol-list',
        universe_ranking: ranked ? 'last_close_turnover' : 'unranked',
        universe_truncated: truncated,
      };
      const isin = text(first(row, 'Isin', 'isin'));
      if (isin) attributes.isin = isin;
      if (liquidity) {
        attributes.last_close_turnover = liquidity.turnover;
        if (liquidity.date) attributes.last_close_date = liquidity.date;
      }
      return {
        ticker: code,
        exchange,
        companyName,
        currency: text(first(row, 'Currency', 'currency')) ?? info.currency,
        country: text(first(row, 'Country', 'country')) ?? info.country,
        // The symbol list carries no classification. Null is honest; inventing
        // a sector here would put a fabricated field in front of the agent.
        sector: null,
        industry: null,
        assetType,
        observedAt,
        provider: 'eodhd',
        sourceUrl,
        attributes,
      };
    });
  }

  private async screenerUniverse(exchange: string, limit: number): Promise<SecurityUniverseRecord[]> {
    const info = exchangeInfo(exchange);
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const payload = await this.request('/api/screener', {
      filters: JSON.stringify([
        ['exchange', '=', info.code],
      ]),
      sort: 'market_capitalization.desc',
      limit: String(boundedLimit),
      offset: '0',
    });
    const root = object(payload);
    const rows = Array.isArray(root.data) ? root.data : Array.isArray(payload) ? payload : [];
    const observedAt = new Date().toISOString();
    return rows.flatMap((value): SecurityUniverseRecord[] => {
      const row = object(value);
      const rawCode = text(first(row, 'code', 'Code', 'symbol'));
      const companyName = text(first(row, 'name', 'Name', 'company_name'));
      if (!rawCode || !companyName) return [];
      const attributes: SecurityUniverseRecord['attributes'] = {};
      const fields: Array<[string, string[]]> = [
        ['market_capitalization', ['market_capitalization', 'marketCapitalization']],
        ['earnings_per_share', ['earnings_share', 'earningsPerShare', 'eps']],
        ['dividend_yield', ['dividend_yield', 'dividendYield']],
        ['average_volume_1d', ['avgvol_1d']],
        ['average_volume_200d', ['avgvol_200d']],
        ['five_day_return_percent', ['refund_5d_p']],
        ['last_close', ['adjusted_close', 'close']],
      ];
      for (const [target, candidates] of fields) {
        const value = finite(first(row, ...candidates));
        if (value != null) attributes[target] = value;
      }
      const lastDay = text(first(row, 'last_day_data_date'));
      if (lastDay) attributes.last_day_data_date = lastDay;
      return [{
        ticker: normalizedTicker(rawCode),
        exchange,
        companyName,
        currency: text(first(row, 'currency', 'Currency')) ?? info.currency,
        country: text(first(row, 'country', 'Country')) ?? info.country,
        sector: text(first(row, 'sector', 'Sector')),
        industry: text(first(row, 'industry', 'Industry')),
        assetType: 'Listed Equity (EODHD screener universe)',
        observedAt,
        provider: this.name,
        sourceUrl: SOURCE_URL,
        attributes,
      }];
    });
  }

  async getDailyBars(ticker: string, exchange: string, fromDate: string, toDate: string): Promise<DailyBar[]> {
    const info = exchangeInfo(exchange);
    const symbol = `${normalizedTicker(ticker)}.${info.code}`;
    const payload = await this.request(`/api/eod/${encodeURIComponent(symbol)}`, {
      from: fromDate,
      to: toDate,
      period: 'd',
      order: 'a',
    });
    if (!Array.isArray(payload)) return [];
    return payload.flatMap((value): DailyBar[] => {
      const row = object(value);
      const date = text(row.date);
      const close = finite(first(row, 'adjusted_close', 'close'));
      if (!date || close == null || close <= 0) return [];
      return [{
        date,
        close,
        currency: info.currency,
        provenance: {
          provider: this.name,
          sourceName: 'EODHD end-of-day historical data',
          sourceUrl: 'https://eodhd.com/financial-apis/api-for-historical-data-and-volumes',
          status: 'OK',
        },
      }];
    });
  }

  async getLatestPrice(ticker: string, exchange: string): Promise<DailyBar | null> {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const bars = await this.getDailyBars(ticker, exchange, from, to);
    return bars.at(-1) ?? null;
  }

  async getFundamentals(ticker: string, exchange: string): Promise<Fundamentals> {
    const info = exchangeInfo(exchange);
    const symbol = `${normalizedTicker(ticker)}.${info.code}`;
    const payload = object(await this.request(`/api/fundamentals/${encodeURIComponent(symbol)}`, {}));
    const general = object(payload.General);
    const highlights = object(payload.Highlights);
    const valuation = object(payload.Valuation);
    const shares = object(payload.SharesStats);
    const financials = object(payload.Financials);
    const cashFlow = latestStatement(object(object(financials.Cash_Flow).yearly));
    const balanceSheet = latestStatement(object(object(financials.Balance_Sheet).yearly));
    const incomeStatement = latestStatement(object(object(financials.Income_Statement).yearly));

    const out: Fundamentals = {
      _source: 'EODHD Fundamentals API',
      _sourceUrl: FUNDAMENTALS_SOURCE_URL,
      _status: 'OK',
      data_as_of: text(first(cashFlow, 'date')) ?? text(first(balanceSheet, 'date')) ?? text(first(incomeStatement, 'date')),
    };
    const values: Array<[string, unknown]> = [
      ['market_capitalization', first(highlights, 'MarketCapitalization', 'MarketCapitalizationMln')],
      ['free_cash_flow', first(cashFlow, 'freeCashFlow', 'FreeCashFlow')],
      ['operating_cash_flow', first(cashFlow, 'totalCashFromOperatingActivities', 'TotalCashFromOperatingActivities')],
      ['capital_expenditure', first(cashFlow, 'capitalExpenditures', 'CapitalExpenditures')],
      ['total_debt', first(balanceSheet, 'shortLongTermDebtTotal', 'totalDebt', 'TotalDebt')],
      ['cash_and_equivalents', first(balanceSheet, 'cash', 'cashAndEquivalents', 'CashAndEquivalents')],
      ['shares_outstanding', first(shares, 'SharesOutstanding', 'sharesOutstanding')],
      ['revenue', first(incomeStatement, 'totalRevenue', 'TotalRevenue')],
      ['net_income', first(incomeStatement, 'netIncome', 'NetIncome')],
      ['ebitda', first(highlights, 'EBITDA')],
      ['pe_ratio', first(highlights, 'PERatio', 'PEGRatio')],
      ['price_to_book', first(valuation, 'PriceBookMRQ', 'PriceBook')],
      ['dividend_yield', first(highlights, 'DividendYield')],
      ['profit_margin', first(highlights, 'ProfitMargin')],
      ['return_on_equity', first(highlights, 'ReturnOnEquityTTM')],
      ['sector', first(general, 'Sector')],
      ['industry', first(general, 'Industry')],
    ];
    for (const [key, raw] of values) {
      const numeric = finite(raw);
      const string = text(raw);
      if (numeric != null) out[key] = numeric;
      else if (string) out[key] = string;
    }
    return out;
  }
}
