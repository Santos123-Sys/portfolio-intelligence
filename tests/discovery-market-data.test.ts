import { describe, expect, it } from 'vitest';
import { loadDiscoveryLatestPrices } from '../src/lib/discovery-market-data';
import type { PriceProvider } from '../src/lib/connectors';

describe('discovery latest-price enrichment', () => {
  it('fetches a security once and shares its latest close across duplicate persisted rows', async () => {
    let calls = 0;
    const provider: PriceProvider = {
      name: 'test-provider',
      supportedExchanges: ['XSWX'],
      async getDailyBars() { return []; },
      async getLatestPrice() {
        calls += 1;
        return { date: '2026-09-08', close: 123.45, currency: 'CHF' };
      },
    };

    const prices = await loadDiscoveryLatestPrices([
      { id: 'first', ticker: 'ALC', exchange: 'XSWX' },
      { id: 'second', ticker: 'alc', exchange: 'xswx' },
    ], provider);

    expect(calls).toBe(1);
    expect(prices.get('first')).toMatchObject({ close: 123.45, currency: 'CHF', asOf: '2026-09-08' });
    expect(prices.get('second')).toMatchObject({ close: 123.45, currency: 'CHF', asOf: '2026-09-08' });
  });

  it('keeps the discovery page usable when one live quote is unavailable', async () => {
    const provider: PriceProvider = {
      name: 'unavailable-provider',
      supportedExchanges: ['XSWX'],
      async getDailyBars() { return []; },
      async getLatestPrice() { throw new Error('provider unavailable'); },
    };
    await expect(loadDiscoveryLatestPrices([
      { id: 'candidate', ticker: 'ALC', exchange: 'XSWX' },
    ], provider)).resolves.toEqual(new Map());
  });
});
