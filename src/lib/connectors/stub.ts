/**
 * Deterministic stub provider for development and tests.
 *
 * Generates a reproducible pseudo-random walk seeded from the ticker, so the
 * same ticker always yields the same series. That matters: a stub returning
 * fresh randomness each call makes test failures non-reproducible.
 *
 * It is named "stub" everywhere it surfaces so no figure derived from it can be
 * mistaken for real market data.
 */
import { DailyBar, Fundamentals, PriceProvider } from './base';

function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class StubProvider implements PriceProvider {
  readonly name = 'stub';
  readonly supportedExchanges = ['XSWX', 'BVMF', 'XNYS', 'XNAS'];

  async getDailyBars(ticker: string, exchange: string, fromDate: string, toDate: string): Promise<DailyBar[]> {
    const rand = mulberry32(seedFrom(`${ticker}:${exchange}`));
    const start = new Date(fromDate);
    const end = new Date(toDate);
    const bars: DailyBar[] = [];
    let price = 50 + rand() * 150;
    const currency = exchange === 'BVMF' ? 'BRL' : 'CHF';
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue; // weekdays only
      price *= 1 + (rand() - 0.49) * 0.03;
      bars.push({ date: d.toISOString().slice(0, 10), close: Number(price.toFixed(4)), currency });
    }
    return bars;
  }

  async getLatestPrice(ticker: string, exchange: string): Promise<DailyBar | null> {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const bars = await this.getDailyBars(ticker, exchange, from, to);
    return bars.length ? bars[bars.length - 1] : null;
  }

  async getFundamentals(ticker: string, exchange: string): Promise<Fundamentals> {
    const rand = mulberry32(seedFrom(`fund:${ticker}:${exchange}`));
    return {
      peRatio: Number((8 + rand() * 25).toFixed(2)),
      dividendYield: Number((rand() * 0.05).toFixed(4)),
      debtToEquity: Number((rand() * 2).toFixed(2)),
      returnOnEquity: Number((rand() * 0.3).toFixed(4)),
      revenueGrowth3Y: Number(((rand() - 0.2) * 0.4).toFixed(4)),
      _source: 'stub — not real market data',
    };
  }
}
