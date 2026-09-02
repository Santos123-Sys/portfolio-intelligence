import { describe, expect, it, vi } from 'vitest';
import type { FundamentalsProvider, PriceProvider } from '../src/lib/connectors/base';
import { EodhdRequestError } from '../src/lib/connectors/eodhd';
import { FinnhubFundamentalsProvider } from '../src/lib/connectors/finnhub';
import { KnownPlanLimitError, type CallResult, type RequestGateway } from '../src/lib/connectors/gateway';
import {
  MINIMUM_NUMERIC_FUNDAMENTALS,
  loadFundamentalsWithFallback,
  numericFundamentalCount,
} from '../src/lib/services/fundamentals-fallback';

function gatewayRecorder() {
  const calls: Array<{ provider: string; endpoint: string; result: CallResult }> = [];
  const gateway: RequestGateway = {
    run: async ({ provider, endpoint, perform, classify }) => {
      const response = await perform();
      calls.push({ provider, endpoint, result: classify(response) });
      return response;
    },
  };
  return { gateway, calls };
}

async function withFetch<T>(handler: (url: URL) => Response, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => handler(new URL(String(input)))) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function primary(getFundamentals: PriceProvider['getFundamentals']): PriceProvider {
  return {
    name: 'eodhd',
    supportedExchanges: ['XSWX', 'BVMF'],
    getDailyBars: async () => [],
    getLatestPrice: async () => null,
    getFundamentals,
  };
}

function fallback(
  values: Record<string, number> = { pe_ratio: 18, profit_margin: 0.2, return_on_equity: 0.15 }
): FundamentalsProvider {
  return {
    name: 'finnhub',
    supportedExchanges: ['XSWX', 'BVMF'],
    getFundamentals: vi.fn().mockResolvedValue({ _status: 'OK', ...values }),
  };
}

describe('Finnhub fundamentals connector', () => {
  it('uses the international symbol and maps Basic Financials without inventing statements', async () => {
    const { gateway, calls } = gatewayRecorder();
    const provider = new FinnhubFundamentalsProvider('test-token', gateway);
    const result = await withFetch(
      (url) => {
        expect(url.pathname).toBe('/api/v1/stock/metric');
        expect(url.searchParams.get('symbol')).toBe('NESN.SW');
        expect(url.searchParams.get('metric')).toBe('all');
        return Response.json({
          metric: {
            marketCapitalization: 245000,
            peTTM: 19.5,
            currentDividendYieldTTM: 3.2,
            netProfitMarginTTM: 14.4,
            roeTTM: 26.1,
            'totalDebt/totalEquityQuarterly': 88,
          },
          series: { annual: { currentRatio: [{ period: '2025-12-31', v: 1.2 }] } },
        });
      },
      () => provider.getFundamentals('NESN', 'XSWX')
    );

    expect(result).toMatchObject({
      pe_ratio: 19.5,
      dividend_yield: 0.032,
      return_on_equity: 0.261,
      debt_to_equity: 0.88,
      data_as_of: '2025-12-31',
    });
    expect(result.profit_margin).toBeCloseTo(0.144);
    expect(result).not.toHaveProperty('market_capitalization');
    expect(result).not.toHaveProperty('free_cash_flow');
    expect(calls).toEqual([{
      provider: 'finnhub',
      endpoint: '/api/v1/stock/metric',
      result: { outcome: 'ok', httpStatus: 200 },
    }]);
  });

  it('maps Brazilian listings to the Finnhub SA suffix', async () => {
    const provider = new FinnhubFundamentalsProvider('test-token');
    await withFetch(
      (url) => {
        expect(url.searchParams.get('symbol')).toBe('PETR4.SA');
        return Response.json({ metric: { peAnnual: 5, roeAnnual: 20, netProfitMarginAnnual: 10 } });
      },
      () => provider.getFundamentals('PETR4', 'BVMF')
    );
  });
});

describe('fundamentals fallback policy', () => {
  it('uses Finnhub only for an EODHD plan-limit response', async () => {
    const secondary = fallback();
    const result = await loadFundamentalsWithFallback({
      primary: primary(async () => { throw new EodhdRequestError(403, '/api/fundamentals/NESN.SW', 'plan'); }),
      fallback: secondary,
      ticker: 'NESN',
      exchange: 'XSWX',
    });
    expect(result).toMatchObject({ provider: 'finnhub', usedFallback: true, reason: 'primary_plan_limit' });
    expect(secondary.getFundamentals).toHaveBeenCalledWith('NESN', 'XSWX');
  });

  it('also falls back when the gateway remembers an earlier EODHD plan limit', async () => {
    const secondary = fallback();
    const result = await loadFundamentalsWithFallback({
      primary: primary(async () => {
        throw new KnownPlanLimitError('eodhd', '/api/fundamentals/:param', 403, new Date());
      }),
      fallback: secondary,
      ticker: 'NESN',
      exchange: 'XSWX',
    });
    expect(result).toMatchObject({ provider: 'finnhub', usedFallback: true, reason: 'primary_plan_limit' });
  });

  it('does not hide authentication or transient primary failures', async () => {
    const secondary = fallback();
    await expect(loadFundamentalsWithFallback({
      primary: primary(async () => { throw new EodhdRequestError(401, '/api/fundamentals/NESN.SW', 'bad key'); }),
      fallback: secondary,
      ticker: 'NESN',
      exchange: 'XSWX',
    })).rejects.toThrow('bad key');
    expect(secondary.getFundamentals).not.toHaveBeenCalled();
  });

  it('falls back from an empty primary payload and fails closed on weak fallback data', async () => {
    await expect(loadFundamentalsWithFallback({
      primary: primary(async () => ({ _status: 'OK' })),
      fallback: fallback({ pe_ratio: 18 }),
      ticker: 'NESN',
      exchange: 'XSWX',
    })).rejects.toThrow(`at least ${MINIMUM_NUMERIC_FUNDAMENTALS}`);
  });

  it('does not count metadata or dates as numeric financial evidence', () => {
    expect(numericFundamentalCount({
      _status: 'OK',
      data_as_of: '2025-12-31',
      pe_ratio: 18,
      return_on_equity: 0.2,
      beta: 0.8,
      '52_week_high': 140,
      '52_week_low': 90,
    })).toBe(2);
  });
});
