import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const env = readFileSync('src/lib/env.ts', 'utf8');
const discovery = readFileSync('src/lib/discovery-provider.ts', 'utf8');
const workflow = readFileSync('src/lib/discovery-workflow.ts', 'utf8');
const connectors = readFileSync('src/lib/connectors/index.ts', 'utf8');
const search = readFileSync('src/lib/search/web-search.ts', 'utf8');
const workerConfig = readFileSync('services/agentic/src/config.ts', 'utf8');
const agenticPipeline = readFileSync('services/agentic/src/openai-pipeline.ts', 'utf8');
const railway = readFileSync('.railway/railway.ts', 'utf8');
const discoveryPage = readFileSync('src/app/ai-stock-discovery/page.tsx', 'utf8');
const discoveryRoute = readFileSync('src/app/api/discovery/runs/route.ts', 'utf8');
const refreshRoute = readFileSync('src/app/api/cron/refresh/route.ts', 'utf8');
const valuationRoute = readFileSync('src/app/api/discovery/valuations/route.ts', 'utf8');

describe('low-cost provider architecture', () => {
  it('separates discovery from EODHD validation', () => {
    expect(env).toContain("DISCOVERY_PROVIDER: z.enum(['eodhd', 'finnhub'])");
    expect(workflow).toContain('loadDiscoveryUniverse(exchange, 25)');
    expect(workflow).toContain('const provider = getPriceProvider();');
  });

  it('keeps Finnhub discovery-only and uses limited research-and-risk analysis', () => {
    expect(discovery).toContain("env.DISCOVERY_PROVIDER === 'finnhub'");
    expect(workflow).toContain("analysisMode: 'limited_research_risk'");
    expect(workflow).toContain('researchEvidence,');
    expect(workflow).not.toContain('FINNHUB_API_KEY');
    expect(connectors).not.toContain('FinnhubFundamentalsProvider');
    expect(refreshRoute).not.toContain('getFundamentals');
    expect(refreshRoute).not.toContain('fundamentals');
    expect(agenticPipeline).toContain('structured financial statements are intentionally unavailable');
    expect(agenticPipeline).toContain('state that DCF remains locked');
  });

  it('locks DCF in both the candidate UI and valuation API', () => {
    expect(discoveryPage).toContain('candidate.dcfLocked');
    expect(discoveryPage).toContain('<strong>DCF locked.</strong>');
    expect(valuationRoute.match(/isDcfLocked\(data\.analysisMode\)/g)).toHaveLength(2);
    expect(valuationRoute).toContain('LIMITED_DATA_DCF_LOCK_REASON');
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

  it('uses a candidate default accepted by the API', () => {
    expect(discoveryPage).toContain("useState('6')");
    expect(discoveryRoute).toContain('.max(7).default(6)');
  });
});
