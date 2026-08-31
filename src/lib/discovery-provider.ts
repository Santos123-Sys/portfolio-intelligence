import { SecurityUniverseRecord, type SecurityUniverseRecord as SecurityUniverseRecordType } from '@portfolio-intelligence/agentic-contract';
import { and, eq, gt } from 'drizzle-orm';
import { db } from './db';
import { discoveryUniverseSnapshots } from './db/workflow-schema';
import { getEnv } from './env';
import { EodhdProvider } from './connectors/eodhd';
import { getProviderGateway } from './services/provider-gateway';

export interface MarketDiscoveryProvider {
  readonly name: 'eodhd' | 'finnhub';
  getSecurityUniverse(exchange: string, limit: number): Promise<SecurityUniverseRecordType[]>;
}

const EXCHANGE_INFO: Record<string, { finnhubCode: string; currency: string; country: string }> = {
  XSWX: { finnhubCode: 'SW', currency: 'CHF', country: 'Switzerland' },
  BVMF: { finnhubCode: 'SA', currency: 'BRL', country: 'Brazil' },
};

const NON_EQUITY = ['etf', 'fund', 'bond', 'index', 'currency', 'warrant', 'right'];

function finite(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function toRecord(row: Record<string, unknown>, exchange: string): SecurityUniverseRecordType | null {
  const info = EXCHANGE_INFO[exchange];
  const symbol = typeof row.symbol === 'string' ? row.symbol.trim() : '';
  const companyName = typeof row.description === 'string' ? row.description.trim() : '';
  const assetType = typeof row.type === 'string' && row.type.trim() ? row.type : 'Listed Equity';
  if (!info || !symbol || !companyName || NON_EQUITY.some((item) => assetType.toLowerCase().includes(item))) return null;
  const ticker = symbol.replace(/\.(SW|SA)$/i, '').toUpperCase();
  const attributes: SecurityUniverseRecordType['attributes'] = { provider_symbol: symbol };
  const mic = typeof row.mic === 'string' ? row.mic : undefined;
  if (mic) attributes.provider_mic = mic;
  const figi = typeof row.figi === 'string' ? row.figi : undefined;
  if (figi) attributes.figi = figi;
  const isin = typeof row.isin === 'string' ? row.isin : undefined;
  if (isin) attributes.isin = isin;
  const marketCap = finite(row.marketCapitalization ?? row.market_capitalization);
  if (marketCap != null) attributes.market_capitalization = marketCap;
  return {
    ticker,
    exchange,
    companyName,
    currency: typeof row.currency === 'string' && row.currency ? row.currency : info.currency,
    country: info.country,
    sector: typeof row.sector === 'string' ? row.sector : null,
    industry: typeof row.industry === 'string' ? row.industry : null,
    assetType,
    observedAt: new Date().toISOString(),
    provider: 'finnhub',
    sourceUrl: 'https://finnhub.io/docs/api/stock-symbols',
    attributes,
  };
}

export class FinnhubDiscoveryProvider implements MarketDiscoveryProvider {
  readonly name = 'finnhub' as const;
  constructor(private readonly apiKey: string) {}

  async getSecurityUniverse(exchange: string, limit: number): Promise<SecurityUniverseRecordType[]> {
    const info = EXCHANGE_INFO[exchange];
    if (!info) throw new Error(`Finnhub exchange mapping is not configured for ${exchange}`);
    const endpoint = '/api/v1/stock/symbol';
    const raw = await getProviderGateway().run({
      provider: this.name,
      endpoint,
      perform: async () => {
        const url = new URL(`https://finnhub.io${endpoint}`);
        url.searchParams.set('exchange', info.finnhubCode);
        url.searchParams.set('token', this.apiKey);
        const response = await fetch(url, { headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`Finnhub stock-symbol request failed: ${response.status} ${response.statusText}`);
        return response.json();
      },
      classify: () => ({ outcome: 'ok', httpStatus: 200 }),
    });
    if (!Array.isArray(raw)) throw new Error(`Finnhub returned an invalid symbol list for ${exchange}`);
    return raw
      .flatMap((value) => value && typeof value === 'object' ? [toRecord(value as Record<string, unknown>, exchange)] : [])
      .filter((value): value is SecurityUniverseRecordType => value !== null)
      .slice(0, Math.max(1, Math.min(limit, 500)));
  }
}

class EodhdDiscoveryProvider implements MarketDiscoveryProvider {
  readonly name = 'eodhd' as const;
  constructor(private readonly provider: EodhdProvider) {}
  getSecurityUniverse(exchange: string, limit: number) {
    return this.provider.getSecurityUniverse(exchange, limit);
  }
}

export function getDiscoveryProvider(): MarketDiscoveryProvider {
  const env = getEnv();
  if (env.DISCOVERY_PROVIDER === 'finnhub') {
    if (!env.FINNHUB_API_KEY) throw new Error('FINNHUB_API_KEY is required when DISCOVERY_PROVIDER=finnhub');
    return new FinnhubDiscoveryProvider(env.FINNHUB_API_KEY);
  }
  if (!env.MARKET_DATA_API_KEY) throw new Error('MARKET_DATA_API_KEY is required when DISCOVERY_PROVIDER=eodhd');
  return new EodhdDiscoveryProvider(new EodhdProvider(env.MARKET_DATA_API_KEY, getProviderGateway()));
}

async function cachedUniverse(provider: string, exchange: string): Promise<SecurityUniverseRecordType[] | null> {
  const [snapshot] = await db.select().from(discoveryUniverseSnapshots).where(and(
    eq(discoveryUniverseSnapshots.provider, provider),
    eq(discoveryUniverseSnapshots.exchange, exchange),
    gt(discoveryUniverseSnapshots.expiresAt, new Date())
  )).limit(1);
  if (!snapshot) return null;
  const parsed = SecurityUniverseRecord.array().safeParse(snapshot.recordsJson);
  return parsed.success ? parsed.data : null;
}

async function saveUniverse(provider: string, exchange: string, records: SecurityUniverseRecordType[]): Promise<void> {
  const hours = getEnv().DISCOVERY_UNIVERSE_CACHE_HOURS;
  await db.insert(discoveryUniverseSnapshots).values({
    provider,
    exchange,
    recordsJson: records,
    expiresAt: new Date(Date.now() + hours * 3_600_000),
  }).onConflictDoUpdate({
    target: [discoveryUniverseSnapshots.provider, discoveryUniverseSnapshots.exchange],
    set: { recordsJson: records, fetchedAt: new Date(), expiresAt: new Date(Date.now() + hours * 3_600_000) },
  });
}

/**
 * Reads live data first and falls back only to a non-expired snapshot. There is
 * deliberately no stub fallback: a stale-but-labelled universe is preferable
 * to invented securities.
 */
export async function loadDiscoveryUniverse(exchange: string, limit: number): Promise<{ records: SecurityUniverseRecordType[]; provider: string; cached: boolean }> {
  const env = getEnv();
  const primary = getDiscoveryProvider();
  try {
    const records = await primary.getSecurityUniverse(exchange, limit);
    if (!records.length) throw new Error(`${primary.name} returned an empty security universe`);
    await saveUniverse(primary.name, exchange, records);
    return { records, provider: primary.name, cached: false };
  } catch (primaryError) {
    const cached = await cachedUniverse(primary.name, exchange);
    if (cached?.length) return { records: cached.slice(0, limit), provider: primary.name, cached: true };
    if (env.DISCOVERY_FALLBACK_PROVIDER === 'eodhd' && primary.name !== 'eodhd') {
      if (!env.MARKET_DATA_API_KEY) throw primaryError;
      const fallback = new EodhdDiscoveryProvider(new EodhdProvider(env.MARKET_DATA_API_KEY, getProviderGateway()));
      const records = await fallback.getSecurityUniverse(exchange, limit);
      if (!records.length) throw primaryError;
      await saveUniverse(fallback.name, exchange, records);
      return { records, provider: fallback.name, cached: false };
    }
    throw primaryError;
  }
}
