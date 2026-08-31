import { describe, expect, it, vi } from 'vitest';
import {
  CallBudgetExceededError,
  KnownPlanLimitError,
  MinuteBudgetTracker,
  endpointTemplate,
  passthroughGateway,
  type RequestGateway,
} from '../src/lib/connectors/gateway';
import { EodhdProvider } from '../src/lib/connectors/eodhd';

// --- endpointTemplate -------------------------------------------------------

describe('endpointTemplate', () => {
  it('leaves a two-segment path alone', () => {
    expect(endpointTemplate('/api/screener')).toBe('/api/screener');
  });

  it('collapses a per-symbol or per-exchange trailing segment', () => {
    expect(endpointTemplate('/api/eod/NESN.SW')).toBe('/api/eod/:param');
    expect(endpointTemplate('/api/eod/ROG.SW')).toBe('/api/eod/:param');
    expect(endpointTemplate('/api/exchange-symbol-list/SW')).toBe('/api/exchange-symbol-list/:param');
    expect(endpointTemplate('/api/eod-bulk-last-day/SW')).toBe('/api/eod-bulk-last-day/:param');
    expect(endpointTemplate('/api/fundamentals/NESN.SW')).toBe('/api/fundamentals/:param');
  });
});

// --- MinuteBudgetTracker -----------------------------------------------------

describe('MinuteBudgetTracker', () => {
  it('allows attempts under the limit and blocks at it', () => {
    const now = 0;
    const tracker = new MinuteBudgetTracker(() => now);
    expect(tracker.wouldExceed('eodhd', 2)).toBe(false);
    tracker.record('eodhd');
    expect(tracker.wouldExceed('eodhd', 2)).toBe(false);
    tracker.record('eodhd');
    expect(tracker.wouldExceed('eodhd', 2)).toBe(true);
  });

  it('forgets attempts once they age out of the 60s window', () => {
    let now = 0;
    const tracker = new MinuteBudgetTracker(() => now);
    tracker.record('eodhd');
    tracker.record('eodhd');
    expect(tracker.wouldExceed('eodhd', 2)).toBe(true);
    now = 60_001;
    expect(tracker.wouldExceed('eodhd', 2)).toBe(false);
  });

  it('tracks providers independently', () => {
    const tracker = new MinuteBudgetTracker(() => 0);
    tracker.record('eodhd');
    tracker.record('eodhd');
    expect(tracker.wouldExceed('eodhd', 2)).toBe(true);
    expect(tracker.wouldExceed('stooq', 2)).toBe(false);
  });
});

// --- passthroughGateway ------------------------------------------------------

describe('passthroughGateway', () => {
  it('calls perform() and returns its result untouched', async () => {
    const perform = vi.fn().mockResolvedValue('result');
    const result = await passthroughGateway.run({
      provider: 'x',
      endpoint: '/x',
      perform,
      classify: () => ({ outcome: 'ok', httpStatus: 200 }),
    });
    expect(result).toBe('result');
    expect(perform).toHaveBeenCalledOnce();
  });
});

// --- error message content ---------------------------------------------------

describe('gateway error messages', () => {
  it('KnownPlanLimitError names the provider, endpoint and last confirmation', () => {
    const seenAt = new Date('2026-08-30T00:00:00Z');
    const error = new KnownPlanLimitError('eodhd', '/api/screener', 403, seenAt);
    expect(error.message).toMatch(/eodhd \/api\/screener/);
    expect(error.message).toMatch(/HTTP 403/);
    expect(error.message).toMatch(/Skipped without a network call/);
  });

  it('CallBudgetExceededError distinguishes the minute and day windows', () => {
    expect(new CallBudgetExceededError('eodhd', 'minute', 60).message).toMatch(/minute call budget of 60/);
    expect(new CallBudgetExceededError('eodhd', 'day', 2000).message).toMatch(/day call budget of 2000/);
  });
});

// --- EodhdProvider routes through an injected gateway ------------------------

function fakeGateway(): RequestGateway & { calls: Array<{ provider: string; endpoint: string }> } {
  const calls: Array<{ provider: string; endpoint: string }> = [];
  return {
    calls,
    run: async ({ provider, endpoint, perform }) => {
      calls.push({ provider, endpoint });
      return perform();
    },
  };
}

async function withFetch<T>(route: (url: string) => { status: number; body: string }, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const { status, body } = route(String(url));
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe('EodhdProvider with an injected gateway', () => {
  it('reports the provider name and templated endpoint for every request', async () => {
    const gateway = fakeGateway();
    const provider = new EodhdProvider('test-token', gateway);
    await withFetch(
      () => ({ status: 200, body: JSON.stringify([{ Code: 'NESN', Name: 'Nestle', Country: 'Switzerland', Currency: 'CHF', Type: 'Common Stock' }]) }),
      () => provider.getSecurityUniverse!('XSWX', 10)
    );
    expect(gateway.calls.length).toBeGreaterThan(0);
    for (const call of gateway.calls) expect(call.provider).toBe('eodhd');
    // screener attempted first, then falls back to the symbol list + bulk turnover — both templated.
    expect(gateway.calls.map((c) => c.endpoint)).toContain('/api/screener');
  });

  it('falls back to the symbol list when the gateway already knows the screener is plan-limited', async () => {
    const gateway: RequestGateway = {
      run: async ({ endpoint, perform }) => {
        if (endpoint === '/api/screener') {
          throw new KnownPlanLimitError('eodhd', '/api/screener', 403, new Date());
        }
        return perform();
      },
    };
    const provider = new EodhdProvider('test-token', gateway);
    const result = await withFetch(
      (url) => {
        if (url.includes('/api/eod-bulk-last-day/')) return { status: 200, body: '[]' };
        return {
          status: 200,
          body: JSON.stringify([{ Code: 'NESN', Name: 'Nestle', Country: 'Switzerland', Currency: 'CHF', Type: 'Common Stock' }]),
        };
      },
      () => provider.getSecurityUniverse!('XSWX', 10)
    );
    // Never reached the network for /api/screener, but still produced a universe via the symbol list.
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe('NESN');
    expect(result[0].attributes?.universe_source).toBe('exchange-symbol-list');
  });

  it('propagates a self-imposed budget error from the required call rather than swallowing it as a plan limit', async () => {
    const gateway: RequestGateway = {
      run: async () => {
        throw new CallBudgetExceededError('eodhd', 'day', 2000);
      },
    };
    const provider = new EodhdProvider('test-token', gateway);
    await expect(provider.getSecurityUniverse!('XSWX', 10)).rejects.toThrow(/self-imposed day call budget/);
  });
});
