import { describe, it, expect } from 'vitest';
import { AnalysisOutput } from '../src/lib/agenteki/schemas';
import { validateGrounding, diffAnalyses } from '../src/lib/agenteki/pipeline';
import type { GroundingBundle } from '../src/lib/agenteki/schemas';

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
  investmentThesis: 'Defensive compounding with reliable distribution.',
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
    expect(() => validateGrounding(fabricated, bundle)).toThrow(/cites data it was not given/);
  });

  it('tolerates formatting differences in metric names', () => {
    const restyled = { ...valid, groundedIn: ['max drawdown', 'P/E ratio'] };
    expect(() => validateGrounding(restyled, bundle)).not.toThrow();
  });

  it('skips validation when nothing was supplied to contradict', () => {
    const empty = { ...bundle, computedMetrics: {}, fundamentals: {} };
    expect(() => validateGrounding(valid, empty)).not.toThrow();
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
