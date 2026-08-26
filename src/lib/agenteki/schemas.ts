/**
 * Agenteki's output contract.
 *
 * The AI is required to return this shape every time. Prose-only responses are
 * rejected, not parsed leniently — a lenient parser is how unstructured output
 * quietly becomes the system's state.
 */

import { z } from 'zod';

export const PortfolioRole = z.enum([
  'swiss_quality',
  'brazilian_growth',
  'fixed_income',
  'not_suitable',
]);

const score = z.number().int().min(0).max(100);

export const AnalysisOutput = z.object({
  ticker: z.string().min(1),
  companyName: z.string().min(1),
  portfolioCandidate: z.boolean(),
  portfolioRole: PortfolioRole,

  investmentScore: score,
  thesisAlignmentScore: score,
  qualityScore: score,
  growthScore: score,
  riskScore: score,
  dividendScore: score,

  fundamentalSummary: z.string().min(1),
  investmentThesis: z.string().min(1),
  keyCatalysts: z.array(z.string()).min(1),
  keyRisks: z.array(z.string()).min(1),
  /** Conditions that would invalidate the thesis. Empty means untested thinking. */
  thesisBreakers: z.array(z.string()).min(1),

  confidenceScore: z.number().min(0).max(1),

  /**
   * Which deterministic values this conclusion rested on. Required and non-empty:
   * an analysis grounded in nothing is an opinion, and the architecture does not
   * permit opinions to be stored as analysis.
   */
  groundedIn: z.array(z.string()).min(1),

  /** Things the model could not determine. Empty is suspicious, not reassuring. */
  informationGaps: z.array(z.string()),
});

export type AnalysisOutput = z.infer<typeof AnalysisOutput>;

export const ThesisCriteria = z.object({
  version: z.number().int().positive(),
  portfolios: z.array(
    z.object({
      role: PortfolioRole,
      currency: z.string(),
      objective: z.string(),
      inclusionCriteria: z.array(z.string()),
      exclusionCriteria: z.array(z.string()),
      targetMetrics: z.record(z.string(), z.string()).optional(),
    })
  ),
  globalConstraints: z.array(z.string()),
});

export type ThesisCriteria = z.infer<typeof ThesisCriteria>;

/** Deterministic facts handed to the model. It may read these; it may not compute. */
export interface GroundingBundle {
  ticker: string;
  companyName: string;
  exchange: string;
  currency: string;
  sector: string | null;
  country: string | null;
  /** Metric name -> value, straight from the quant engine. */
  computedMetrics: Record<string, number>;
  /** Newest input timestamp behind those metrics. */
  dataAsOf: string;
  fundamentals: Record<string, number | string | null>;
}

export class AgentekiError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AgentekiError';
  }
}
