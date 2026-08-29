import { describe, expect, it } from 'vitest';
import { EodhdProvider } from '../src/lib/connectors/eodhd';

/**
 * These cover the distinction that cost a live debugging round-trip: the same
 * valid token returned real SIX and B3 closes from /api/eod while /api/screener
 * 403'd, because EODHD gates endpoints separately. A bare status code sent the
 * reader looking for a broken key instead of a plan limit.
 */
async function messageFor(status: number, call: (p: EodhdProvider) => Promise<unknown>): Promise<string> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status })) as unknown as typeof fetch;
  try {
    await call(new EodhdProvider('test-token'));
    throw new Error('expected a failure');
  } catch (e) {
    return (e as Error).message;
  } finally {
    globalThis.fetch = original;
  }
}

describe('EODHD failure messages', () => {
  it('names the Screener API and says a 403 is a plan limit, not a bad key', async () => {
    const message = await messageFor(403, (p) => p.getSecurityUniverse('XSWX', 10));
    expect(message).toMatch(/Screener API/);
    expect(message).toMatch(/token was accepted/);
    expect(message).toMatch(/not a broken key/);
    expect(message).toMatch(/verify:provider eodhd/);
  });

  it('names end-of-day prices when that endpoint 403s', async () => {
    const message = await messageFor(403, (p) => p.getDailyBars('NESN', 'XSWX', '2026-08-01', '2026-08-28'));
    expect(message).toMatch(/end-of-day prices/);
    expect(message).not.toMatch(/Screener/);
  });

  it('treats 401 as a token problem and points at the quoting trap', async () => {
    const message = await messageFor(401, (p) => p.getSecurityUniverse('XSWX', 10));
    expect(message).toMatch(/rejected the token/);
    expect(message).toMatch(/MARKET_DATA_API_KEY/);
    expect(message).toMatch(/quotes/);
  });

  it('marks 429 and 5xx as retriable', async () => {
    expect(await messageFor(429, (p) => p.getSecurityUniverse('XSWX', 10))).toMatch(/rate limit.*retry/is);
    expect(await messageFor(503, (p) => p.getSecurityUniverse('XSWX', 10))).toMatch(/server error.*retry/is);
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
