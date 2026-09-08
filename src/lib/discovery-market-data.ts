import type { PriceProvider } from './connectors';

export type DiscoveryPriceIdentity = {
  id: string;
  ticker: string;
  exchange: string;
};

export type DiscoveryLatestPrice = {
  close: number;
  currency: string;
  asOf: string;
  provider: string;
  sourceUrl: string | null;
};

type CachedPrice = DiscoveryLatestPrice & { expiresAt: number };

// A discovery shortlist is deliberately small, but its cards can re-render or
// be reopened frequently. A short cache avoids re-querying a provider for the
// same end-of-day close while keeping the displayed observation current enough
// for a review workflow. The date and provider remain visible to the user.
const latestPriceCache = new Map<string, CachedPrice>();
const PRICE_CACHE_MS = 5 * 60_000;

function securityKey(candidate: Pick<DiscoveryPriceIdentity, 'ticker' | 'exchange'>): string {
  return `${candidate.exchange.trim().toUpperCase()}:${candidate.ticker.trim().toUpperCase()}`;
}

export async function loadDiscoveryLatestPrices(
  candidates: DiscoveryPriceIdentity[],
  provider: PriceProvider
): Promise<Map<string, DiscoveryLatestPrice>> {
  const output = new Map<string, DiscoveryLatestPrice>();
  // Deterministic development data must never be labelled as a current market
  // price on an investment-research screen.
  if (provider.name === 'stub') return output;
  const unique = new Map<string, DiscoveryPriceIdentity>();
  for (const candidate of candidates) unique.set(securityKey(candidate), candidate);

  const queue = [...unique.values()];
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const candidate = queue[next++];
      const key = `${provider.name}:${securityKey(candidate)}`;
      const cached = latestPriceCache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        output.set(candidate.id, cached);
        continue;
      }
      try {
        const latest = await provider.getLatestPrice(candidate.ticker, candidate.exchange);
        if (!latest || !Number.isFinite(latest.close) || latest.close <= 0) continue;
        const price: DiscoveryLatestPrice = {
          close: latest.close,
          currency: latest.currency,
          asOf: latest.date,
          provider: latest.provenance?.provider ?? provider.name,
          sourceUrl: latest.provenance?.sourceUrl ?? null,
        };
        latestPriceCache.set(key, { ...price, expiresAt: Date.now() + PRICE_CACHE_MS });
        output.set(candidate.id, price);
      } catch {
        // A quote is an enhancement to discovery review. Provider entitlement
        // or a single unavailable symbol must never hide an otherwise valid
        // candidate or make the whole shortlist fail to load.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));

  // Copy a shared quote to every row with that security identity. This also
  // keeps this function correct if an older persisted run contains duplicates.
  for (const candidate of candidates) {
    const source = unique.get(securityKey(candidate));
    if (source) {
      const price = output.get(source.id);
      if (price) output.set(candidate.id, price);
    }
  }
  return output;
}
