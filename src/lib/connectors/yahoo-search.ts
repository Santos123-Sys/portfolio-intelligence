import { DailyBar, Fundamentals, PriceProvider } from './base';
import { searchWeb, WebSearchResult } from '../search/web-search';

function yahooSymbol(ticker: string, exchange: string): string {
  const clean = ticker.replace(/\.(SA|SW)$/i, '');
  if (exchange === 'BVMF') return `${clean}.SA`;
  if (exchange === 'XSWX') return `${clean}.SW`;
  return ticker;
}

function currencyFor(exchange: string): string {
  if (exchange === 'BVMF') return 'BRL';
  if (exchange === 'XSWX') return 'CHF';
  return 'USD';
}

function firstYahooResult(results: WebSearchResult[]): WebSearchResult | null {
  return results.find((r) => /finance\.yahoo\.com\/quote/i.test(r.url)) ?? results[0] ?? null;
}

function normalizeNumber(s: string): number | null {
  const cleaned = s.replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractCurrencyAnchoredNumber(text: string, currency: string): number | null {
  const escaped = currency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`${escaped}\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)`, 'i'),
    new RegExp(`([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*${escaped}`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeNumber(match[1]);
  }
  return null;
}

function extractNamedMetric(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const pattern = new RegExp(`${label}[^0-9-]{0,40}(-?[0-9][0-9,]*(?:\\.[0-9]+)?)\\s*%?`, 'i');
    const match = text.match(pattern);
    if (match?.[1]) return normalizeNumber(match[1]);
  }
  return null;
}

/**
 * Search-mediated Yahoo Finance provider.
 *
 * This does not scrape Yahoo pages and does not call undocumented Yahoo APIs.
 * It asks a configured web-search provider for Yahoo Finance result snippets,
 * records source/query provenance, and returns DATA_UNAVAILABLE when a value
 * cannot be extracted conservatively from the search result text.
 */
export class YahooSearchProvider implements PriceProvider {
  readonly name = 'yahoo-search';
  readonly supportedExchanges = ['XSWX', 'BVMF', 'XNYS', 'XNAS'];

  async getDailyBars(): Promise<DailyBar[]> {
    // Search snippets are not a valid 252-day historical data source. The system
    // must accumulate observations over time or use a licensed historical vendor.
    return [];
  }

  async getLatestPrice(ticker: string, exchange: string): Promise<DailyBar | null> {
    const symbol = yahooSymbol(ticker, exchange);
    const currency = currencyFor(exchange);
    const query = `site:finance.yahoo.com/quote/${symbol} Yahoo Finance ${symbol} ${currency} stock price`;
    const response = await searchWeb(query, 5);
    const source = firstYahooResult(response.results);
    const combined = `${source?.title ?? ''} ${source?.snippet ?? ''}`;
    const parsed = extractCurrencyAnchoredNumber(combined, currency);

    if (!source || parsed === null) {
      return null;
    }

    return {
      date: new Date().toISOString().slice(0, 10),
      close: parsed,
      currency,
      provenance: {
        provider: response.provider,
        sourceName: source.title,
        sourceUrl: source.url,
        query: response.query,
        status: 'OK',
        evidenceSnippet: source.snippet,
        rawPayload: response.rawPayload,
      },
    };
  }

  async getFundamentals(ticker: string, exchange: string): Promise<Fundamentals> {
    const symbol = yahooSymbol(ticker, exchange);
    const query = `site:finance.yahoo.com/quote/${symbol}/key-statistics Yahoo Finance ${symbol} PE ratio dividend yield debt equity return on equity revenue growth`;
    const response = await searchWeb(query, 5);
    const source = firstYahooResult(response.results);
    const text = `${source?.title ?? ''} ${source?.snippet ?? ''}`;

    const out: Fundamentals = {
      _source: 'yahoo-search via Brave Search snippets',
      _sourceUrl: source?.url ?? null,
      _query: response.query,
      _status: source ? 'OK' : 'DATA_UNAVAILABLE',
      _evidenceSnippet: source?.snippet ?? null,
    };

    const peRatio = extractNamedMetric(text, ['PE Ratio', 'P/E', 'Trailing P/E']);
    const dividendYield = extractNamedMetric(text, ['Dividend Yield', 'Forward Dividend']);
    const debtToEquity = extractNamedMetric(text, ['Debt/Equity', 'Debt to Equity']);
    const returnOnEquity = extractNamedMetric(text, ['Return on Equity', 'ROE']);
    const revenueGrowth = extractNamedMetric(text, ['Revenue Growth', 'Quarterly Revenue Growth']);

    if (peRatio !== null) out.peRatio = peRatio;
    if (dividendYield !== null) out.dividendYield = dividendYield / 100;
    if (debtToEquity !== null) out.debtToEquity = debtToEquity;
    if (returnOnEquity !== null) out.returnOnEquity = returnOnEquity / 100;
    if (revenueGrowth !== null) out.revenueGrowth = revenueGrowth / 100;

    return out;
  }
}
