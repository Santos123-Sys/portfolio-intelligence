import { describe, expect, it } from 'vitest';
import { AgenticRunRequest } from '@portfolio-intelligence/agentic-contract';
import {
  analysisModeFromRequest,
  isDcfLocked,
  LIMITED_RESEARCH_RISK_MODE,
} from '../src/lib/integrations/analysis-mode';

const portfolioId = '11111111-1111-4111-8111-111111111111';
const thesisId = '22222222-2222-4222-8222-222222222222';

function request(analysisMode?: 'limited_research_risk') {
  return AgenticRunRequest.parse({
    thesis: {
      versionId: thesisId,
      criteria: {
        version: 1,
        portfolios: [{
          role: 'swiss_quality',
          currency: 'CHF',
          objective: 'Durable compounding',
          inclusionCriteria: ['Durable business'],
          exclusionCriteria: [],
        }],
        globalConstraints: [],
      },
    },
    securities: [{ ticker: 'NESN', exchange: 'XSWX', portfolioId }],
    portfolios: [{
      id: portfolioId,
      name: 'Swiss Quality',
      baseCurrency: 'CHF',
      investmentObjective: 'Durable compounding',
    }],
    groundingBundles: [{
      portfolioId,
      bundle: {
        ticker: 'NESN',
        companyName: 'Nestle',
        exchange: 'XSWX',
        currency: 'CHF',
        sector: 'Consumer staples',
        country: 'CH',
        computedMetrics: { 'securityRiskMetric:volatility:asof': 0.14 },
        dataAsOf: '2026-09-02T00:00:00.000Z',
        fundamentals: analysisMode ? {} : { 'fundamental:free_cash_flow:1': 100 },
        ...(analysisMode ? {
          analysisMode,
          researchEvidence: { 'research:rationale:1': 'Source-backed thesis fit.' },
        } : {}),
      },
    }],
  });
}

describe('analysis data modes', () => {
  it('locks DCF for limited research-and-risk runs', () => {
    const mode = analysisModeFromRequest(request(LIMITED_RESEARCH_RISK_MODE), 'NESN', 'XSWX');
    expect(mode).toBe('limited_research_risk');
    expect(isDcfLocked(mode)).toBe(true);
  });

  it('preserves historical full-fundamentals runs without a mode field', () => {
    const mode = analysisModeFromRequest(request(), 'NESN', 'XSWX');
    expect(mode).toBe('full_fundamentals');
    expect(isDcfLocked(mode)).toBe(false);
  });

  it('does not infer a mode from malformed or mismatched requests', () => {
    expect(analysisModeFromRequest({}, 'NESN', 'XSWX')).toBeNull();
    expect(analysisModeFromRequest(request(), 'ROG', 'XSWX')).toBeNull();
  });
});
