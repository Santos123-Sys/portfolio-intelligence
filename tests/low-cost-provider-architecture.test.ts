import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const env = readFileSync('src/lib/env.ts', 'utf8');
const discovery = readFileSync('src/lib/discovery-provider.ts', 'utf8');
const workflow = readFileSync('src/lib/discovery-workflow.ts', 'utf8');
const search = readFileSync('src/lib/search/web-search.ts', 'utf8');
const workerConfig = readFileSync('services/agentic/src/config.ts', 'utf8');
const railway = readFileSync('.railway/railway.ts', 'utf8');

describe('low-cost provider architecture', () => {
  it('separates discovery from EODHD validation', () => {
    expect(env).toContain("DISCOVERY_PROVIDER: z.enum(['eodhd', 'finnhub'])");
    expect(workflow).toContain('loadDiscoveryUniverse(exchange, 25)');
    expect(workflow).toContain('const provider = getPriceProvider();');
  });

  it('has a real cached-universe path instead of a synthetic fallback', () => {
    expect(discovery).toContain('discoveryUniverseSnapshots');
    expect(discovery).toContain('cachedUniverse');
    expect(discovery).toContain('deliberately no stub fallback');
  });

  it('supports Tavily through the server-only web-search boundary', () => {
    expect(env).toContain("z.enum(['none', 'brave', 'tavily'])");
    expect(workerConfig).toContain("WEB_SEARCH_PROVIDER: z.enum(['none', 'brave', 'tavily'])");
    expect(search).toContain("https://api.tavily.com/search");
    expect(search).toContain('authorization: `Bearer ${env.WEB_SEARCH_API_KEY}`');
  });

  it('keeps manual provider credentials in the owning Railway services', () => {
    expect(railway).toContain('DISCOVERY_PROVIDER: preserve()');
    expect(railway).toContain('FINNHUB_API_KEY: preserve()');
    expect(railway).toContain('WEB_SEARCH_PROVIDER: preserve()');
    expect(railway).toContain('WEB_SEARCH_API_KEY: preserve()');
  });
});
