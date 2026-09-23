import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DiscoveryRunRequest,
  MarketDiscoveryOutput,
  validateDiscoveryOutput,
} from '@portfolio-intelligence/agentic-contract';
import { discountedCashFlow, threeCaseDiscountedCashFlow, assessDcfSuitability } from '../src/lib/quant/dcf';
import { computeStandaloneSecurityRisk } from '../src/lib/quant/security-risk';
import { EodhdProvider } from '../src/lib/connectors/eodhd';
import { dcfReportFileName, renderDcfReportPdf } from '../src/lib/dcf-report';
import { calculateIntegratedComps, calculateIntegratedDcf, type IntegratedDcfInput, type IntegratedPeer } from '../src/lib/quant/integrated-valuation';

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

  it('keeps worst, base and optimistic cases as separate deterministic calculations', () => {
    const common = {
      currency: 'CHF', startingFreeCashFlow: 100, forecastYears: 5, netDebt: 50,
      sharesOutstanding: 10, dataAsOf: '2026-08-29T00:00:00.000Z', sourceReferences: ['fundamental:source-id'],
    };
    const result = threeCaseDiscountedCashFlow({
      worst_case: { ...common, annualGrowthRate: 0.01, discountRate: 0.12, terminalGrowthRate: 0.01 },
      base_case: { ...common, annualGrowthRate: 0.05, discountRate: 0.1, terminalGrowthRate: 0.02 },
      optimistic_case: { ...common, annualGrowthRate: 0.08, discountRate: 0.09, terminalGrowthRate: 0.025 },
    });
    expect(result.method).toBe('three_case_two_stage_fcff');
    expect(result.scenarios.map((scenario) => scenario.name)).toEqual(['worst_case', 'base_case', 'optimistic_case']);
    expect(result.scenarios[0]!.result.fairValuePerShare).toBeLessThan(result.scenarios[1]!.result.fairValuePerShare);
    expect(result.scenarios[2]!.result.fairValuePerShare).toBeGreaterThan(result.scenarios[1]!.result.fairValuePerShare);
  });

  it('rejects source records that contradict the stated scenario order', () => {
    const common = {
      currency: 'CHF', startingFreeCashFlow: 100, forecastYears: 5, netDebt: 50,
      sharesOutstanding: 10, dataAsOf: '2026-08-29T00:00:00.000Z', sourceReferences: ['fundamental:source-id'],
    };
    expect(() => threeCaseDiscountedCashFlow({
      worst_case: { ...common, annualGrowthRate: 0.08, discountRate: 0.09, terminalGrowthRate: 0.025 },
      base_case: { ...common, annualGrowthRate: 0.05, discountRate: 0.1, terminalGrowthRate: 0.02 },
      optimistic_case: { ...common, annualGrowthRate: 0.01, discountRate: 0.12, terminalGrowthRate: 0.01 },
    })).toThrow(/worst-case ≤ base-case ≤ optimistic-case/);
  });

  it('renders the stored three-scenario model as a native PDF', async () => {
    const common = {
      currency: 'CHF', startingFreeCashFlow: 100, forecastYears: 5, netDebt: 50,
      sharesOutstanding: 10, dataAsOf: '2026-08-29T00:00:00.000Z', sourceReferences: ['fundamental:source-id'],
    };
    const result = threeCaseDiscountedCashFlow({
      worst_case: { ...common, annualGrowthRate: 0.01, discountRate: 0.12, terminalGrowthRate: 0.01 },
      base_case: { ...common, annualGrowthRate: 0.05, discountRate: 0.1, terminalGrowthRate: 0.02 },
      optimistic_case: { ...common, annualGrowthRate: 0.08, discountRate: 0.09, terminalGrowthRate: 0.025 },
    });
    const pdf = await renderDcfReportPdf({
      companyName: 'Nestle SA', ticker: 'NESN', exchange: 'XSWX', result,
      sourceReferences: ['fundamental:free_cash_flow:source-id'],
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1_000);
    expect(dcfReportFileName('NESN / XSWX')).toBe('nesn-xswx-three-scenario-dcf.pdf');
  });

  it('routes financial institutions away from an automatic FCFF DCF', () => {
    expect(assessDcfSuitability('Financial Services', ['free_cash_flow']).status)
      .toBe('alternative_method_recommended');
  });
});

describe('integrated DCF and Comps motor', () => {
  const peers: IntegratedPeer[] = [
    { id: '1', companyName: 'Peer One', ticker: 'ONE', sharePrice: 20, dilutedShares: 10, totalDebt: 30, cash: 5, revenue: 100, ebitda: 20, netIncome: 8, included: true },
    { id: '2', companyName: 'Peer Two', ticker: 'TWO', sharePrice: 25, dilutedShares: 8, totalDebt: 20, cash: 4, revenue: 90, ebitda: 18, netIncome: 0, included: true },
    { id: '3', companyName: 'Excluded Peer', ticker: 'OUT', sharePrice: 40, dilutedShares: 7, totalDebt: 10, cash: 2, revenue: 110, ebitda: -3, netIncome: -4, included: false },
  ];
  const dcfInput: IntegratedDcfInput = {
    riskFreeRate: 0.04, marketRiskPremium: 0.05, beta: 1.1, costOfDebt: 0.06, taxRate: 0.2, debtToCapital: 0.25,
    baseRevenue: 1000, baseEbitdaMargin: 0.2, daPercent: 0.04, capexPercent: 0.05, nwcPercent: 0.01,
    revenueGrowth: [0.1, 0.09, 0.08, 0.07, 0.06], ebitdaMargin: [0.2, 0.205, 0.21, 0.21, 0.21],
    capexPercentForecast: [0.05, 0.05, 0.05, 0.05, 0.05], nwcPercentForecast: [0.01, 0.01, 0.01, 0.01, 0.01],
    perpetuityGrowthRate: 0.025, exitMultiple: 10, targetDebt: 120, targetCash: 40, dilutedShares: 50, targetNetIncome: 70,
  };

  it('recalculates included peer statistics and excludes invalid profitability multiples', () => {
    const result = calculateIntegratedComps(peers);
    expect(result.includedCount).toBe(2);
    expect(result.rows[0]!.enterpriseValue).toBe(225);
    expect(result.rows[2]!.evEbitda).toBeNull();
    expect(result.rows[2]!.pe).toBeNull();
    expect(result.evEbitda.count).toBe(2);
    expect(result.pe.count).toBe(1);
    expect(calculateIntegratedComps(peers.map((peer) => ({ ...peer, included: peer.id !== '1' }))).evEbitda.count).toBe(1);
  });

  it('links Comps median EV/EBITDA into the exit method without changing WACC', () => {
    const comps = calculateIntegratedComps(peers);
    const linked = calculateIntegratedDcf(dcfInput, comps.evEbitda.median);
    const standalone = calculateIntegratedDcf(dcfInput, null);
    expect(linked.wacc).toBe(standalone.wacc);
    expect(linked.exitTerminalValue).toBeCloseTo(linked.projections[4]!.ebitda * comps.evEbitda.median!);
    expect(linked.projections).toHaveLength(5);
    expect(linked.sensitivities).toHaveLength(125);
    expect(linked.perpetuityPerShare).not.toBeNull();
    expect(linked.baseYear.ufcf).toBeCloseTo(108);
  });

  it('does not emit DCF values when WACC is non-positive', () => {
    const invalid = calculateIntegratedDcf({ ...dcfInput, riskFreeRate: -0.1, marketRiskPremium: 0, costOfDebt: 0, debtToCapital: 0 }, null);
    expect(invalid.wacc).toBeLessThanOrEqual(0);
    expect(invalid.projections.every((row) => !Number.isFinite(row.presentValue))).toBe(true);
    expect(invalid.perpetuityPerShare).toBeNull();
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
