import { describe, it, expect } from 'vitest';
import {
  AnalysisOutput,
  GroundingBundle as GroundingBundleSchema,
  type GroundingBundle,
} from '../src/lib/integrations/analysis-contract';
import { validateGrounding, diffAnalyses } from '../src/lib/integrations/analysis-validation';

const bundle: GroundingBundle = {
  ticker: 'NESN', companyName: 'Nestle', exchange: 'XSWX', currency: 'CHF',
  sector: 'Consumer Staples', country: 'CH',
  computedMetrics: { Volatility: 0.14, Sharpe: 0.82, MaxDrawdown: 0.19 },
  dataAsOf: '2026-08-25T00:00:00Z',
  fundamentals: { peRatio: 19.2, dividendYield: 0.031 },
};

const valid: AnalysisOutput = {
  ticker: 'NESN', companyName: 'Nestle', portfolioCandidate: true,
  portfolioRole: 'swiss_quality',
  investmentScore: 78, thesisAlignmentScore: 84, qualityScore: 88,
  growthScore: 55, riskScore: 30, dividendScore: 72,
  fundamentalSummary: 'Stable staples franchise.',
  investmentThesis: 'Affirmative case: Defensive compounding. Strongest counter-case: Distribution resilience could weaken.',
  keyCatalysts: ['Pricing power'], keyRisks: ['FX translation'],
  thesisBreakers: ['Sustained margin compression below 15%'],
  confidenceScore: 0.72,
  groundedIn: ['Sharpe', 'MaxDrawdown', 'peRatio'],
  informationGaps: ['No segment-level revenue supplied'],
};

describe('output schema', () => {
  it('accepts a well-formed analysis', () => {
    expect(AnalysisOutput.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty groundedIn — opinions are not analysis', () => {
    const r = AnalysisOutput.safeParse({ ...valid, groundedIn: [] });
    expect(r.success).toBe(false);
  });

  it('rejects empty thesisBreakers — untested thinking', () => {
    expect(AnalysisOutput.safeParse({ ...valid, thesisBreakers: [] }).success).toBe(false);
  });

  it('rejects out-of-range scores', () => {
    expect(AnalysisOutput.safeParse({ ...valid, investmentScore: 140 }).success).toBe(false);
    expect(AnalysisOutput.safeParse({ ...valid, confidenceScore: 1.4 }).success).toBe(false);
  });

  it('rejects a non-integer score', () => {
    expect(AnalysisOutput.safeParse({ ...valid, qualityScore: 88.5 }).success).toBe(false);
  });
});

describe('grounding validation — the anti-hallucination guard', () => {
  it('passes when every reference was actually supplied', () => {
    expect(() => validateGrounding(valid, bundle)).not.toThrow();
  });

  it('CATCHES a cited metric that was never computed', () => {
    const fabricated = { ...valid, groundedIn: ['Sharpe', 'SortinoRatio'] };
    expect(() => validateGrounding(fabricated, bundle)).toThrow(/Grounding validation failed/);
  });

  it('requires exact provenance keys rather than fuzzy aliases', () => {
    const restyled = { ...valid, groundedIn: ['max drawdown', 'P/E ratio'] };
    expect(() => validateGrounding(restyled, bundle)).toThrow(/Grounding validation failed/);
  });

  it('rejects an analysis when no grounding was supplied', () => {
    const empty = { ...bundle, computedMetrics: {}, fundamentals: {} };
    expect(() => validateGrounding(valid, empty)).toThrow(/No grounding was supplied/);
  });

  it('accepts source-backed research keys in limited-data mode', () => {
    const limited = GroundingBundleSchema.parse({
      ...bundle,
      analysisMode: 'limited_research_risk',
      fundamentals: {},
      researchEvidence: { 'research:rationale:candidate-1': 'Source-backed thesis fit.' },
    });
    expect(() => validateGrounding({
      ...valid,
      groundedIn: ['research:rationale:candidate-1', 'MaxDrawdown'],
      informationGaps: ['Structured financial statements unavailable; DCF locked'],
    }, limited)).not.toThrow();
  });

  it('rejects structured fundamentals inside limited-data mode', () => {
    expect(() => GroundingBundleSchema.parse({
      ...bundle,
      analysisMode: 'limited_research_risk',
      researchEvidence: { 'research:rationale:candidate-1': 'Source-backed thesis fit.' },
    })).toThrow(/cannot contain structured fundamentals/);
  });
});

describe('analysis diffing', () => {
  it('surfaces changed scores so revisions are visible', () => {
    const next = { ...valid, investmentScore: 61, portfolioCandidate: false };
    const d = diffAnalyses(valid, next);
    const fields = d.map((x) => x.field);
    expect(fields).toContain('investmentScore');
    expect(fields).toContain('portfolioCandidate');
    expect(d.find((x) => x.field === 'investmentScore')).toMatchObject({ from: 78, to: 61 });
  });

  it('returns nothing when the analysis is unchanged', () => {
    expect(diffAnalyses(valid, { ...valid })).toHaveLength(0);
  });
});
