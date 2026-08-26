import { getEnv } from '../env';
import { PriceProvider } from './base';
import { StubProvider } from './stub';
import { YahooSearchProvider } from './yahoo-search';

/**
 * Provider selection. Adding a real vendor means implementing PriceProvider and
 * adding one case here — nothing else in the codebase changes.
 */
export function getPriceProvider(): PriceProvider {
  const env = getEnv();
  switch (env.MARKET_DATA_PROVIDER) {
    case 'stub':
      return new StubProvider();
    case 'yahoo-search':
      return new YahooSearchProvider();
    case 'twelvedata':
    case 'eodhd':
      throw new Error(
        `Provider '${env.MARKET_DATA_PROVIDER}' is not implemented yet. ` +
          `Implement PriceProvider in src/lib/connectors/ and register it here.`
      );
    default:
      throw new Error(`Unknown MARKET_DATA_PROVIDER: ${env.MARKET_DATA_PROVIDER}`);
  }
}
export * from './base';
export { StubProvider } from './stub';
export { YahooSearchProvider } from './yahoo-search';
