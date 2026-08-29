import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DiscoveryRunRequest,
  MarketDiscoveryOutput,
  validateDiscoveryOutput,
} from '@portfolio-intelligence/agentic-contract';
import { discountedCashFlow, assessDcfSuitability } from '../src/lib/quant/dcf';
import { computeStandaloneSecurityRisk } from '../src/lib/quant/security-risk';
import { EodhdProvider } from '../src/lib/connectors/eodhd';

const portfolioId = '11111111-1111-4111-8111-111111111111';
const thesisId = '22222222-2222-4222-8222-222222222222';

afterEach(() => vi.unstubAllGlobals());

function discoveryRequest() {
  return DiscoveryRunRequest.parse({
    thesis: {
      versionId: thesisId,
      criteria: {
        version: 1,
        portfolios: [{
          role: 'swiss_quality',
          currency: 'CHF',
          objective: 'Durable compounding',
          inclusionCriteria: ['Recurring cash flow'],
          exclusionCriteria: ['Speculative balance sheets'],
        }],
        globalConstraints: ['No autonomous trading'],
      },
    },
    portfolios: [{
      id: portfolioId,
      name: 'Swiss Quality',
      role: 'swiss_quality',
      baseCurrency: 'CHF',
      investmentObjective: 'Durable compounding',
    }],
    universe: [{
      ticker: 'NESN',
      exchange: 'XSWX',
      companyName: 'Nestle SA',
      currency: 'CHF',
      country: 'Switzerland',
      sector: 'Consumer Defensive',
      industry: 'Packaged Foods',
      assetType: 'Common Stock',
      observedAt: '2026-08-29T12:00:00.000Z',
      provider: 'eodhd',
      sourceUrl: 'https://eodhd.com/financial-apis/stock-market-screener-api',
      attributes: { market_capitalization: 200_000_000_000, dividend_yield: 0.03 },
    }],
    maxCandidatesPerPortfolio: 5,
  });
}

function discoveryOutput() {
  return MarketDiscoveryOutput.parse({
    thesisVersion: 1,
    marketMandates: [{
      portfolioId,
      role: 'swiss_quality',
      exchanges: ['XSWX'],
      currency: 'CHF',
      rationale: 'The supplied thesis assigns Swiss quality equities to this portfolio.',
    }],
    candidates: [{
      portfolioId,
      ticker: 'NESN',
      exchange: 'XSWX',
      companyName: 'Nestle SA',
      currency: 'CHF',
      country: 'Switzerland',
      sector: 'Consumer Defensive',
      thesisAlignmentScore: 78,
      rationale: 'The supplied identity and dividend field support initial review.',
      matchedCriteria: ['Swiss listing'],
      violatedCriteria: [],
      groundedIn: ['identity:exchange', 'attribute:dividend_yield'],
      sourceUrls: ['https://eodhd.com/financial-apis/stock-market-screener-api'],
      informationGaps: ['Recurring cash flow is not present in the screener universe'],
    }],
    verifiedWebSources: [],
    limitations: ['The provider universe is not proof of complete market coverage'],
  });
}

describe('provider-grounded stock discovery', () => {
  it('accepts a candidate present in the supplied universe', () => {
    expect(() => validateDiscoveryOutput(discoveryOutput(), discoveryRequest())).not.toThrow();
  });

  it('rejects an invented ticker and fabricated grounding key', () => {
    const output = discoveryOutput();
    output.candidates[0].ticker = 'INVENTED';
    output.candidates[0].groundedIn = ['attribute:imaginary_metric'];
    expect(() => validateDiscoveryOutput(output, discoveryRequest())).toThrow(/absent from the supplied universe/);
  });

  it('rejects a model-authored web URL that the service did not verify', () => {
    const output = discoveryOutput();
    output.candidates[0].sourceUrls.push('https://example.com/invented-evidence');
    expect(() => validateDiscoveryOutput(output, discoveryRequest())).toThrow(/absent from its universe record/);
  });

  it('accepts an additional URL copied from actual web-search metadata', () => {
    const output = discoveryOutput();
    output.verifiedWebSources.push('https://issuer.example.com/annual-report');
    output.candidates[0].sourceUrls.push('https://issuer.example.com/annual-report');
    expect(() => validateDiscoveryOutput(output, discoveryRequest())).not.toThrow();
  });
});

describe('EODHD adapter', () => {
  it('normalizes a provider row into the constrained exchange universe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{
        code: 'NESN.SW',
        name: 'Nestle SA',
        currency: 'CHF',
        country: 'Switzerland',
        sector: 'Consumer Defensive',
        industry: 'Packaged Foods',
        market_capitalization: 200_000_000_000,
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const records = await new EodhdProvider('test-token').getSecurityUniverse('XSWX', 10);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      ticker: 'NESN',
      exchange: 'XSWX',
      currency: 'CHF',
      provider: 'eodhd',
    });
    expect(records[0].attributes.market_capitalization).toBe(200_000_000_000);
  });

  it('does not expose the API token in provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })));
    const provider = new EodhdProvider('super-secret-provider-token');
    // The status is still identified, but the message now explains what a 401
    // means at EODHD rather than only naming the code. The property this test
    // exists for — the token never reaching the message — is unchanged.
    await expect(provider.getSecurityUniverse('XSWX', 10)).rejects.toThrow(/401/);
    await expect(provider.getSecurityUniverse('XSWX', 10)).rejects.not.toThrow(/super-secret-provider-token/);
  });
});

describe('deterministic DCF', () => {
  it('calculates an auditable fair-value scenario and sensitivity grid', () => {
    const result = discountedCashFlow({
      currency: 'CHF',
      startingFreeCashFlow: 100,
      forecastYears: 5,
      annualGrowthRate: 0.05,
      discountRate: 0.1,
      terminalGrowthRate: 0.02,
      netDebt: 50,
      sharesOutstanding: 10,
      dataAsOf: '2026-08-29T00:00:00.000Z',
      sourceReferences: ['fundamental:free_cash_flow:source-id'],
    });
    expect(result.method).toBe('two_stage_fcff');
    expect(result.fairValuePerShare).toBeGreaterThan(0);
    expect(result.projections).toHaveLength(5);
    expect(result.sensitivity).toHaveLength(25);
    expect(result.methodology).toContain('Gordon-growth');
  });

  it('rejects a discount rate that does not exceed terminal growth', () => {
    expect(() => discountedCashFlow({
      currency: 'CHF',
      startingFreeCashFlow: 100,
      forecastYears: 5,
      annualGrowthRate: 0.05,
      discountRate: 0.02,
      terminalGrowthRate: 0.02,
      netDebt: 0,
      sharesOutstanding: 10,
      dataAsOf: '2026-08-29T00:00:00.000Z',
      sourceReferences: ['source'],
    })).toThrow(/must exceed terminal growth/);
  });

  it('routes financial institutions away from an automatic FCFF DCF', () => {
    expect(assessDcfSuitability('Financial Services', ['free_cash_flow']).status)
      .toBe('alternative_method_recommended');
  });
});

describe('standalone candidate risk', () => {
  it('computes volatility, drawdown and two VaR methods from an observed price series', () => {
    const bars = Array.from({ length: 80 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      close: 100 + index * 0.2 + Math.sin(index) * 2,
      currency: 'CHF',
    }));
    const metrics = computeStandaloneSecurityRisk(bars);
    expect(metrics.map((metric) => metric.metricName)).toEqual([
      'Volatility',
      'MaxDrawdown',
      'VaR_95_1d_Historical',
      'VaR_95_1d_Parametric',
    ]);
    expect(metrics.every((metric) => metric.lookbackDays !== null)).toBe(true);
  });
});
