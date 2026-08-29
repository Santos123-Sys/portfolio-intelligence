import { describe, it, expect } from 'vitest';
import {
  StooqProvider,
  parseStooqCsv,
  stooqSymbol,
  STOOQ_SUFFIX,
  COVERAGE_PROBES,
} from '../src/lib/connectors/stooq';
import { ProviderError, assertCoversRequiredExchanges, type PriceProvider } from '../src/lib/connectors/base';

const CSV = `Date,Open,High,Low,Close,Volume
2026-08-20,92.10,92.80,91.75,92.40,1250000
2026-08-21,92.40,93.15,92.00,93.05,1310000
2026-08-22,93.05,93.60,92.55,92.80,980000`;

describe('stooqSymbol', () => {
  it('maps the required exchanges to a suffixed lowercase symbol', () => {
    expect(stooqSymbol('NESN', 'XSWX')).toBe('nesn.ch');
    expect(stooqSymbol('WEGE3', 'BVMF')).toBe('wege3.br');
  });

  it('strips a suffix the caller already applied, so NESN.SW and NESN agree', () => {
    expect(stooqSymbol('NESN.SW', 'XSWX')).toBe(stooqSymbol('NESN', 'XSWX'));
    expect(stooqSymbol('WEGE3.SA', 'BVMF')).toBe(stooqSymbol('WEGE3', 'BVMF'));
  });

  it('does not eat part of a ticker that merely ends in letters', () => {
    // PETR4 has no two-letter trailing suffix, so nothing should be stripped.
    expect(stooqSymbol('PETR4', 'BVMF')).toBe('petr4.br');
  });

  it('throws on an exchange it has no mapping for', () => {
    expect(() => stooqSymbol('7203', 'XTKS')).toThrow(ProviderError);
  });
});

describe('parseStooqCsv', () => {
  it('parses rows oldest-first with currency and provenance attached', () => {
    const bars = parseStooqCsv(CSV, 'CHF', 'nesn.ch');
    expect(bars).toHaveLength(3);
    expect(bars[0]).toMatchObject({ date: '2026-08-20', close: 92.4, currency: 'CHF' });
    expect(bars[2].close).toBe(92.8);
    expect(bars[0].provenance).toMatchObject({ provider: 'stooq', status: 'OK' });
    expect(bars[0].provenance?.sourceUrl).toContain('nesn.ch');
  });

  it('throws rather than returning empty when the symbol is unknown', () => {
    // Stooq answers an unknown symbol with 200 and a non-CSV body; treating
    // that as "no trading today" would hide a typo'd ticker indefinitely.
    expect(() => parseStooqCsv('No data', 'CHF', 'nope.ch')).toThrow(/no usable data/i);
    expect(() => parseStooqCsv('', 'CHF', 'nope.ch')).toThrow(ProviderError);
  });

  it('throws when the CSV lacks the columns it needs', () => {
    expect(() => parseStooqCsv('Date,Open,High\n2026-08-20,1,2', 'CHF', 'x.ch')).toThrow(
      /no Date\/Close columns/
    );
  });

  it('skips halted-day rows instead of writing a zero close', () => {
    // A 0 close would read as a 100% drawdown in the risk engine.
    const withGap = `Date,Open,High,Low,Close,Volume
2026-08-20,92.10,92.80,91.75,92.40,1250000
2026-08-21,,,,,0
2026-08-22,93.05,93.60,92.55,92.80,980000`;
    const bars = parseStooqCsv(withGap, 'CHF', 'nesn.ch');
    expect(bars).toHaveLength(2);
    expect(bars.every((b) => b.close > 0)).toBe(true);
  });

  it('tolerates a trailing newline', () => {
    expect(parseStooqCsv(CSV + '\n', 'CHF', 'nesn.ch')).toHaveLength(3);
  });
});

describe('StooqProvider', () => {
  const okFetch = async () => new Response(CSV, { status: 200 });

  it('declares the exchanges it maps, and covers both required ones', () => {
    const p = new StooqProvider(okFetch as unknown as typeof fetch);
    expect(p.supportedExchanges).toEqual(Object.keys(STOOQ_SUFFIX));
    // The contract every candidate vendor must satisfy (connectors/base.ts).
    expect(() => assertCoversRequiredExchanges(p)).not.toThrow();
  });

  it('returns the most recent close as the latest price', async () => {
    const p = new StooqProvider(okFetch as unknown as typeof fetch);
    const bar = await p.getLatestPrice('NESN', 'XSWX');
    expect(bar).toMatchObject({ date: '2026-08-22', close: 92.8, currency: 'CHF' });
  });

  it('labels B3 bars in BRL and SIX bars in CHF', async () => {
    const p = new StooqProvider(okFetch as unknown as typeof fetch);
    expect((await p.getLatestPrice('WEGE3', 'BVMF'))?.currency).toBe('BRL');
    expect((await p.getLatestPrice('NESN', 'XSWX'))?.currency).toBe('CHF');
  });

  it('passes the date range through as Stooq d1/d2 params', async () => {
    let seen = '';
    const spy = (async (url: string) => {
      seen = url;
      return new Response(CSV, { status: 200 });
    }) as unknown as typeof fetch;
    await new StooqProvider(spy).getDailyBars('NESN', 'XSWX', '2026-01-01', '2026-08-22');
    expect(seen).toContain('s=nesn.ch');
    expect(seen).toContain('d1=20260101');
    expect(seen).toContain('d2=20260822');
  });

  it('surfaces an HTTP error as a ProviderError naming the symbol', async () => {
    const bad = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(new StooqProvider(bad).getLatestPrice('NESN', 'XSWX')).rejects.toThrow(/HTTP 503/);
  });

  it('surfaces a network failure as a ProviderError, not a raw throw', async () => {
    const dead = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(new StooqProvider(dead).getLatestPrice('NESN', 'XSWX')).rejects.toThrow(ProviderError);
  });

  it('does not implement getFundamentals — Stooq publishes none', () => {
    // The refresh job branches on this being absent. Returning {} would write
    // a successful-looking empty provenance record.
    // Typed as the interface, where getFundamentals is optional — that is
    // exactly how the refresh job sees it.
    const p: PriceProvider = new StooqProvider(okFetch as unknown as typeof fetch);
    expect(p.getFundamentals).toBeUndefined();
  });
});

describe('COVERAGE_PROBES', () => {
  it('probes both required exchanges plus a known-good control', () => {
    const exchanges = new Set(COVERAGE_PROBES.map((p) => p.exchange));
    expect(exchanges.has('XSWX')).toBe(true);
    expect(exchanges.has('BVMF')).toBe(true);
    // Without a control, a total network failure is indistinguishable from
    // "this vendor lacks the exchanges we need".
    expect(COVERAGE_PROBES.some((p) => /control/i.test(p.note))).toBe(true);
  });
});
