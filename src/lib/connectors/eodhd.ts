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
    if (!response.ok) throw new Error(`EODHD request failed with HTTP ${response.status}`);
    return response.json();
  }

  async getSecurityUniverse(exchange: string, limit: number): Promise<SecurityUniverseRecord[]> {
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
