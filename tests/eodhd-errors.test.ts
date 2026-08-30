import { describe, expect, it } from 'vitest';
import { EodhdProvider, describeEodhdFailure } from '../src/lib/connectors/eodhd';

/**
 * Covers the distinction that cost a live debugging round-trip: the same valid
 * token returned real SIX and B3 closes from /api/eod while /api/screener 403'd,
 * because EODHD entitles endpoints separately. A bare status code sent the
 * reader looking for a broken key instead of a plan limit.
 */
describe('describeEodhdFailure', () => {
  it('names the Screener API and says a 403 is a plan limit, not a bad key', () => {
    const message = describeEodhdFailure('/api/screener', 403);
    expect(message).toMatch(/Screener API/);
    expect(message).toMatch(/stock discovery needs/);
    expect(message).toMatch(/token was accepted/);
    expect(message).toMatch(/not a broken key/);
    expect(message).toMatch(/verify:provider eodhd/);
  });

  it('names end-of-day prices when that endpoint 403s', () => {
    const message = describeEodhdFailure('/api/eod/NESN.SW', 403);
    expect(message).toMatch(/end-of-day prices/);
    expect(message).not.toMatch(/Screener/);
  });

  it('treats 401 as a token problem and points at the quoting trap', () => {
    const message = describeEodhdFailure('/api/screener', 401);
    expect(message).toMatch(/rejected the token/);
    expect(message).toMatch(/MARKET_DATA_API_KEY/);
    expect(message).toMatch(/quotes/);
  });

  it('marks 429 and 5xx as retriable', () => {
    expect(describeEodhdFailure('/api/eod/X.SW', 429)).toMatch(/rate limit.*retry/is);
    expect(describeEodhdFailure('/api/eod/X.SW', 503)).toMatch(/server error.*retry/is);
  });
});

// --- fetch stubbing -------------------------------------------------------

type Route = (url: string) => { status: number; body: string };

async function withRoutes<T>(route: Route, run: (p: EodhdProvider) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const { status, body } = route(String(url));
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  try {
    return await run(new EodhdProvider('test-token'));
  } finally {
    globalThis.fetch = original;
  }
}

const SYMBOL_LIST = JSON.stringify([
  { Code: 'NESN', Name: 'Nestle SA', Country: 'Switzerland', Exchange: 'SW', Currency: 'CHF', Type: 'Common Stock', Isin: 'CH0038863350' },
  { Code: 'ZZZZ', Name: 'Tiny Corp', Country: 'Switzerland', Exchange: 'SW', Currency: 'CHF', Type: 'Common Stock', Isin: null },
  { Code: 'AAAA', Name: 'Alphabetically First AG', Country: 'Switzerland', Exchange: 'SW', Currency: 'CHF', Type: 'Common Stock', Isin: null },
  { Code: 'SMICHA', Name: 'An ETF', Country: 'Switzerland', Exchange: 'SW', Currency: 'CHF', Type: 'ETF', Isin: null },
  { Code: 'PETR4', Name: 'Petrobras PN', Country: 'Brazil', Exchange: 'SA', Currency: 'BRL', Type: 'Preferred Stock', Isin: null },
]);

const BULK = JSON.stringify([
  { code: 'NESN', date: '2026-08-28', close: 78.62, volume: 30_000_000 },
  { code: 'AAAA', date: '2026-08-28', close: 2, volume: 1_000 },
  { code: 'ZZZZ', date: '2026-08-28', close: 1, volume: 500 },
  { code: 'PETR4', date: '2026-08-28', close: 43.55, volume: 9_000_000 },
]);

describe('getSecurityUniverse on a plan without the Screener API', () => {
  const basicPlan: Route = (url) =>
    url.includes('/api/screener') ? { status: 403, body: '' }
    : url.includes('/api/exchange-symbol-list') ? { status: 200, body: SYMBOL_LIST }
    : url.includes('/api/eod-bulk-last-day') ? { status: 200, body: BULK }
    : { status: 404, body: '' };

  it('falls back to the exchange symbol list instead of failing', async () => {
    const records = await withRoutes(basicPlan, (p) => p.getSecurityUniverse('XSWX', 10));
    expect(records.length).toBeGreaterThan(0);
    expect(records.map((r) => r.ticker)).toContain('NESN');
  });

  it('ranks by turnover so the large caps survive truncation', async () => {
    // The whole point: an alphabetical cut of one would return AAAA and drop
    // Nestlé, which would make discovery useless while looking successful.
    const [top] = await withRoutes(basicPlan, (p) => p.getSecurityUniverse('XSWX', 1));
    expect(top.ticker).toBe('NESN');
  });

  it('keeps preferred shares — PETR4 is preferred and is a B3 large cap', async () => {
    const records = await withRoutes(basicPlan, (p) => p.getSecurityUniverse('XSWX', 10));
    expect(records.map((r) => r.ticker)).toContain('PETR4');
  });

  it('drops ETFs and other non-equity instruments', async () => {
    const records = await withRoutes(basicPlan, (p) => p.getSecurityUniverse('XSWX', 10));
    expect(records.map((r) => r.ticker)).not.toContain('SMICHA');
  });

  it('records provenance so the agent can disclose how the universe was chosen', async () => {
    const records = await withRoutes(basicPlan, (p) => p.getSecurityUniverse('XSWX', 2));
    const nesn = records.find((r) => r.ticker === 'NESN')!;
    expect(nesn.attributes.universe_source).toBe('exchange-symbol-list');
    expect(nesn.attributes.universe_ranking).toBe('last_close_turnover');
    expect(nesn.attributes.universe_truncated).toBe(true);
    expect(nesn.attributes.last_close_turnover).toBe(78.62 * 30_000_000);
    expect(nesn.attributes.isin).toBe('CH0038863350');
    expect(nesn.provider).toBe('eodhd');
  });

  it('never invents a sector the symbol list does not carry', async () => {
    const records = await withRoutes(basicPlan, (p) => p.getSecurityUniverse('XSWX', 10));
    expect(records.every((r) => r.sector === null && r.industry === null)).toBe(true);
  });

  it('survives a 423 on the bulk endpoint — the status this plan actually returns', async () => {
    // Measured against a live Basic plan: /api/eod-bulk-last-day answers 423
    // while /api/eod and /api/exchange-symbol-list both answer 200. An earlier
    // version rethrew anything that was not a 403, so this exact combination
    // would have failed discovery on a plan where it works.
    const basicPlanWith423: Route = (url) =>
      url.includes('/api/exchange-symbol-list') ? { status: 200, body: SYMBOL_LIST }
      : url.includes('/api/eod-bulk-last-day') ? { status: 423, body: '' }
      : { status: 403, body: '' };
    const records = await withRoutes(basicPlanWith423, (p) => p.getSecurityUniverse('XSWX', 10));
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].attributes.universe_ranking).toBe('unranked');
  });

  it('falls back past a 423 on the screener too, not just a 403', async () => {
    const records = await withRoutes(
      (url) =>
        url.includes('/api/screener') ? { status: 423, body: '' }
        : url.includes('/api/exchange-symbol-list') ? { status: 200, body: SYMBOL_LIST }
        : { status: 200, body: BULK },
      (p) => p.getSecurityUniverse('XSWX', 10)
    );
    expect(records.map((r) => r.ticker)).toContain('NESN');
  });

  it('lets an unavailable ranking endpoint degrade rather than kill the run, whatever the status', async () => {
    // Ranking is an enhancement; the symbol list is the requirement. A 500 on
    // the optional call must not take down a universe that is otherwise fine.
    const records = await withRoutes(
      (url) =>
        url.includes('/api/screener') ? { status: 403, body: '' }
        : url.includes('/api/exchange-symbol-list') ? { status: 200, body: SYMBOL_LIST }
        : { status: 500, body: '' }, // the optional ranking call
      (p) => p.getSecurityUniverse('XSWX', 10)
    );
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].attributes.universe_ranking).toBe('unranked');
  });

  it('degrades to unranked, and says so, when the bulk endpoint is also unavailable', async () => {
    const noBulk: Route = (url) =>
      url.includes('/api/exchange-symbol-list') ? { status: 200, body: SYMBOL_LIST } : { status: 403, body: '' };
    const records = await withRoutes(noBulk, (p) => p.getSecurityUniverse('XSWX', 10));
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].attributes.universe_ranking).toBe('unranked');
  });

  it('surfaces the failure when every universe source is unavailable', async () => {
    await expect(
      withRoutes(() => ({ status: 403, body: '' }), (p) => p.getSecurityUniverse('XSWX', 10))
    ).rejects.toThrow(/exchange-symbol-list/);
  });

  it('does not swallow a non-plan-limit screener failure', async () => {
    // Only a plan limit is recoverable on the required call. A 500 there is a
    // real fault and must surface rather than be masked by the fallback.
    await expect(
      withRoutes(
        (url) => (url.includes('/api/screener') ? { status: 500, body: '' } : { status: 200, body: SYMBOL_LIST }),
        (p) => p.getSecurityUniverse('XSWX', 10)
      )
    ).rejects.toThrow(/server error/);
  });

  it('describes 423 as a plan limit, not a broken key', () => {
    const message = describeEodhdFailure('/api/eod-bulk-last-day/SW', 423);
    expect(message).toMatch(/not included in your plan/);
    expect(message).toMatch(/token itself is fine/);
  });

  it('never echoes the API token, which travels in the query string', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    try {
      await new EodhdProvider('sk-SECRET-TOKEN-VALUE').getSecurityUniverse('XSWX', 10);
      throw new Error('expected a failure');
    } catch (e) {
      expect((e as Error).message).not.toContain('sk-SECRET-TOKEN-VALUE');
    } finally {
      globalThis.fetch = original;
    }
  });
});
