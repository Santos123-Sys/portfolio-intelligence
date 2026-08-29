/**
 * Stooq daily-bar provider — free, keyless, no registration.
 *
 * WHY THIS ONE, given ADR-005 has been open for so long. The shortlist for
 * "free and covers both SIX Swiss and B3" is short, and every candidate
 * trades away something:
 *
 *   Stooq          no key, no signup, no quota, plain CSV. Prices only —
 *                  no fundamentals. Undocumented but stable for years, and
 *                  a static CSV endpoint has very little surface to break.
 *   Twelve Data    documented, explicitly lists XSWX and BVMF, 800 calls/day
 *                  free. Needs a key and an account. The better long-term
 *                  answer if fundamentals are needed; still unimplemented.
 *   Yahoo direct   richest free data for both exchanges (.SW and .SA), but
 *                  the chart/quoteSummary endpoints are undocumented and
 *                  this codebase has already ruled them out on purpose —
 *                  see yahoo-search.ts, which goes through a search provider
 *                  specifically to avoid calling them. Not reopened here.
 *   Alpha Vantage  25 requests/day on the free tier, thin outside the US.
 *
 * So: Stooq for prices today with nothing to sign up for, Twelve Data as the
 * upgrade path when fundamentals are needed. getFundamentals is deliberately
 * not implemented rather than faked — see the note on that below.
 *
 * COVERAGE IS NOT YET CONFIRMED for XSWX and BVMF specifically, which is the
 * exact question that has kept ADR-005 open. It could not be confirmed from
 * the environment this was written in (outbound network policy blocks
 * stooq.com). Do not flip MARKET_DATA_PROVIDER to 'stooq' on the strength of
 * this file alone — run `npm run verify:provider` from somewhere with open
 * network access first. That script probes real tickers on both exchanges and
 * prints what actually came back, which is the evidence ADR-005 has been
 * waiting for.
 */

import { DailyBar, Fundamentals, PriceProvider, ProviderError } from './base';

const STOOQ_BASE = 'https://stooq.com/q/d/l/';

/**
 * Exchange (MIC) -> Stooq symbol suffix.
 *
 * UNVERIFIED for XSWX and BVMF — see the file header. Stooq's suffixes follow
 * country rather than exchange (`.US`, `.DE`, `.UK`, `.JP`), so these are the
 * consistent guesses, not confirmed values. `npm run verify:provider` reports
 * which suffix actually returns data; correct this map from that output rather
 * than by trial and error in production.
 */
export const STOOQ_SUFFIX: Record<string, string> = {
  XSWX: '.CH',
  BVMF: '.BR',
  XNYS: '.US',
  XNAS: '.US',
};

export const STOOQ_CURRENCY: Record<string, string> = {
  XSWX: 'CHF',
  BVMF: 'BRL',
  XNYS: 'USD',
  XNAS: 'USD',
};

export function stooqSymbol(ticker: string, exchange: string): string {
  const suffix = STOOQ_SUFFIX[exchange];
  if (!suffix) {
    throw new ProviderError(`Stooq: no symbol suffix known for exchange ${exchange}`, 'stooq');
  }
  // Strip any suffix the caller already applied, so 'NESN.SW' and 'NESN' both work.
  const clean = ticker.replace(/\.[A-Za-z]{2}$/, '');
  return `${clean}${suffix}`.toLowerCase();
}

function yyyymmdd(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '');
}

/**
 * Parses Stooq's daily CSV.
 *
 * Exported and pure so the parser is testable without network access — which
 * matters more than usual here, since the network path itself cannot be
 * exercised in CI.
 *
 * Stooq answers an unknown symbol with a 200 and a body that is not a CSV
 * header (historically "No data"). Treating that as an empty result would
 * make a typo'd ticker look like a quiet holiday; it throws instead.
 */
export function parseStooqCsv(csv: string, currency: string, symbol: string): DailyBar[] {
  const text = csv.trim();
  if (text === '' || !/^Date,/i.test(text)) {
    throw new ProviderError(
      `Stooq returned no usable data for '${symbol}'. Body began: ` +
        `${JSON.stringify(text.slice(0, 80))}. Most likely the symbol or its ` +
        `exchange suffix is wrong — check STOOQ_SUFFIX against verify:provider output.`,
      'stooq'
    );
  }

  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf('date');
  const closeIdx = header.indexOf('close');
  if (dateIdx === -1 || closeIdx === -1) {
    throw new ProviderError(
      `Stooq CSV for '${symbol}' has no Date/Close columns; header was: ${lines[0]}`,
      'stooq'
    );
  }

  const bars: DailyBar[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue;
    const cols = line.split(',');
    const date = cols[dateIdx]?.trim();
    const close = Number(cols[closeIdx]);
    // A row with a null close is a real Stooq occurrence on halted days. Skip
    // it rather than writing a 0 that the quant engine would treat as a 100%
    // drawdown.
    if (!date || !Number.isFinite(close) || close <= 0) continue;
    bars.push({
      date,
      close,
      currency,
      provenance: {
        provider: 'stooq',
        sourceName: 'Stooq daily CSV',
        sourceUrl: `${STOOQ_BASE}?s=${symbol}&i=d`,
        status: 'OK',
      },
    });
  }
  return bars;
}

export class StooqProvider implements PriceProvider {
  readonly name = 'stooq';
  readonly supportedExchanges = Object.keys(STOOQ_SUFFIX);

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async fetchCsv(symbol: string, fromDate?: string, toDate?: string): Promise<string> {
    const params = new URLSearchParams({ s: symbol, i: 'd' });
    if (fromDate) params.set('d1', yyyymmdd(fromDate));
    if (toDate) params.set('d2', yyyymmdd(toDate));
    const url = `${STOOQ_BASE}?${params.toString()}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url);
    } catch (e) {
      throw new ProviderError(`Stooq request failed for '${symbol}': ${(e as Error).message}`, 'stooq');
    }
    if (!res.ok) {
      throw new ProviderError(`Stooq returned HTTP ${res.status} for '${symbol}'`, 'stooq');
    }
    return res.text();
  }

  async getDailyBars(
    ticker: string,
    exchange: string,
    fromDate: string,
    toDate: string
  ): Promise<DailyBar[]> {
    const symbol = stooqSymbol(ticker, exchange);
    const currency = STOOQ_CURRENCY[exchange] ?? 'USD';
    const csv = await this.fetchCsv(symbol, fromDate, toDate);
    return parseStooqCsv(csv, currency, symbol);
  }

  async getLatestPrice(ticker: string, exchange: string): Promise<DailyBar | null> {
    const symbol = stooqSymbol(ticker, exchange);
    const currency = STOOQ_CURRENCY[exchange] ?? 'USD';
    const csv = await this.fetchCsv(symbol);
    const bars = parseStooqCsv(csv, currency, symbol);
    // Stooq returns oldest-first; the last row is the most recent close.
    return bars.length > 0 ? bars[bars.length - 1] : null;
  }

  /**
   * Intentionally absent.
   *
   * PriceProvider makes getFundamentals optional precisely so a price-only
   * source can be honest about being price-only. Stooq publishes no
   * fundamentals; returning {} here would be worse than not implementing it,
   * because recordFundamentalObservations would then write a successful-looking
   * empty observation and the provenance trail would claim a source was
   * consulted. The refresh job already branches on this method existing.
   */
}

/** Reference tickers used by the coverage check. Real, liquid listings on each
 * required exchange, so an empty result means missing coverage rather than an
 * obscure security. */
export const COVERAGE_PROBES: Array<{ ticker: string; exchange: string; note: string }> = [
  { ticker: 'NESN', exchange: 'XSWX', note: 'Nestlé — SIX Swiss' },
  { ticker: 'ROG', exchange: 'XSWX', note: 'Roche — SIX Swiss' },
  { ticker: 'WEGE3', exchange: 'BVMF', note: 'WEG — B3' },
  { ticker: 'PETR4', exchange: 'BVMF', note: 'Petrobras — B3' },
  { ticker: 'AAPL', exchange: 'XNAS', note: 'Apple — control, known covered' },
];

export function stooqProbeUrl(ticker: string, exchange: string): string {
  return `${STOOQ_BASE}?s=${stooqSymbol(ticker, exchange)}&i=d`;
}
