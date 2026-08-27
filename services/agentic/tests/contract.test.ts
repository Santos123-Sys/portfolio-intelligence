import { describe, expect, it } from 'vitest';
import {
  AnalysisOutput,
  PortfolioAnalysisManifest,
  ThesisExtractionResult,
  validateAnalysisSemantics,
  validateGrounding,
  validateManifestAgainstRequest,
  validateRunRequestCoherence,
  validateSynthesisCoverage,
} from '@portfolio-intelligence/agentic-contract';
import { buildManifest, hashManifest } from '../src/manifest.js';
import { validateSynthesisEvidence } from '../src/openai-pipeline.js';
import { analysis, grounding, manifest, portfolioId, runRequest, synthesis, thesis } from './fixtures.js';

describe('thesis extraction contract', () => {
  it('accepts explicit criteria, ambiguities, unmapped content and multiple roles', () => {
    const result = ThesisExtractionResult.parse({
      criteria: {
        ...thesis,
        portfolios: [
          ...thesis.portfolios,
          {
            role: 'brazilian_growth',
            currency: 'BRL',
            objective: 'Structural growth',
            inclusionCriteria: ['Expanding market'],
            exclusionCriteria: [],
          },
        ],
      },
      extractionConfidence: 0.68,
      ambiguousPoints: [{
        location: 'Growth portfolio',
        issue: 'Reasonable leverage has no numeric threshold',
        sourceExcerpt: 'reasonable leverage',
      }],
      unmappedContent: ['Long-term ownership philosophy'],
    });
    expect(result.criteria.portfolios).toHaveLength(2);
    expect(result.criteria.portfolios[1].targetMetrics).toBeUndefined();
    expect(result.ambiguousPoints[0].issue).toMatch(/no numeric threshold/);
  });

  it('rejects an empty extracted portfolio list', () => {
    expect(() => ThesisExtractionResult.parse({
      criteria: { version: 1, portfolios: [], globalConstraints: [] },
      extractionConfidence: 0.2,
      ambiguousPoints: [],
      unmappedContent: [],
    })).toThrow();
  });
});

describe('security analysis safeguards', () => {
  it('accepts a complete grounded analysis', () => {
    expect(AnalysisOutput.parse(analysis).informationGaps).toHaveLength(1);
    expect(() => validateAnalysisSemantics(analysis)).not.toThrow();
    expect(() => validateGrounding(analysis, grounding)).not.toThrow();
  });

  it('supports analysis without risk metrics when the gap is explicit', () => {
    const noRiskBundle = {
      ...grounding,
      computedMetrics: { 'position:weight:position-1': 0.12 },
    };
    const noRiskAnalysis = {
      ...analysis,
      groundedIn: ['fundamental:free_cash_flow:observation-1'],
      confidenceScore: 0.45,
      informationGaps: ['No risk metric was supplied'],
    };
    expect(() => validateGrounding(noRiskAnalysis, noRiskBundle)).not.toThrow();
  });

  it('keeps a high-quality but unsuitable company out of the portfolio', () => {
    const excluded = {
      ...analysis,
      qualityScore: 94,
      thesisAlignmentScore: 20,
      investmentScore: 35,
      portfolioCandidate: false,
      portfolioRole: 'not_suitable' as const,
      thesisBreakers: ['A confirmed hard exclusion applies'],
    };
    expect(() => validateAnalysisSemantics(excluded)).not.toThrow();
    expect(excluded.portfolioCandidate).toBe(false);
  });

  it('enforces the investment-score thesis-alignment cap', () => {
    expect(() => validateAnalysisSemantics({
      ...analysis,
      thesisAlignmentScore: 20,
      investmentScore: 36,
    })).toThrow(/must be <= 35/);
  });

  it('preserves low confidence and rejects fabricated grounding references', () => {
    expect(AnalysisOutput.parse({ ...analysis, confidenceScore: 0.2 }).confidenceScore).toBe(0.2);
    expect(() => validateGrounding({ ...analysis, groundedIn: ['invented:Sortino'] }, grounding))
      .toThrow(/invented:Sortino/);
  });
});

describe('synthesis and manifest integrity', () => {
  it('covers every supplied security exactly once and rejects omissions', () => {
    expect(() => validateSynthesisCoverage(synthesis, [analysis])).not.toThrow();
    expect(() => validateSynthesisEvidence(synthesis, [analysis], [grounding])).not.toThrow();
    expect(() => validateSynthesisCoverage({ ...synthesis, perSecurityNarratives: [] }, [analysis]))
      .toThrow(/missing=NESN/);
  });

  it('rejects concentration values and watchlist entries absent from supplied evidence', () => {
    expect(() => validateSynthesisEvidence({
      ...synthesis,
      concentrationFlags: ['The supplied weight is 0.25.'],
    }, [analysis], [grounding])).toThrow(/0.25/);
    expect(() => validateSynthesisEvidence({
      ...synthesis,
      watchlistAndViolations: ['Monitor the breaker.'],
    }, [analysis], [grounding])).toThrow(/supplied ticker/);
  });

  it('validates request coherence and the complete manifest', () => {
    expect(() => validateRunRequestCoherence(runRequest)).not.toThrow();
    expect(() => validateManifestAgainstRequest(manifest, runRequest)).not.toThrow();
    expect(PortfolioAnalysisManifest.parse(manifest).schemaVersion).toBe('1.0');
  });

  it('rejects a silently omitted security', () => {
    const secondRequest = {
      ...runRequest,
      securities: [...runRequest.securities, { ticker: 'ROG', exchange: 'XSWX', portfolioId }],
      groundingBundles: [...runRequest.groundingBundles, {
        portfolioId,
        bundle: { ...grounding, ticker: 'ROG', companyName: 'Roche' },
      }],
    };
    expect(() => validateManifestAgainstRequest(manifest, secondRequest)).toThrow(/coverage changed/);
  });

  it('generates stable manifests and hashes for stable inputs', () => {
    const generatedAt = new Date('2026-08-26T12:00:00.000Z');
    const first = buildManifest(runRequest, [{ portfolioId, analyses: [analysis], synthesis }], generatedAt);
    const second = buildManifest(runRequest, [{ portfolioId, analyses: [analysis], synthesis }], generatedAt);
    expect(first).toEqual(second);
    expect(hashManifest(first)).toBe(hashManifest(second));
    expect(hashManifest({ ...second, thesisVersion: 2 })).not.toBe(hashManifest(second));
  });
});
