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
  thesisBreakers: z.array(z.string()).min(1),
  confidenceScore: z.number().min(0).max(1),
  groundedIn: z.array(z.string()).min(1),
  informationGaps: z.array(z.string()),
});

export type AnalysisOutput = z.infer<typeof AnalysisOutput>;

export const ThesisCriteria = z.object({
  version: z.number().int().positive(),
  portfolios: z.array(z.object({
    role: PortfolioRole,
    currency: z.string(),
    objective: z.string(),
    inclusionCriteria: z.array(z.string()),
    exclusionCriteria: z.array(z.string()),
    targetMetrics: z.record(z.string(), z.string()).optional(),
  })).min(1),
  globalConstraints: z.array(z.string()),
});

export type ThesisCriteria = z.infer<typeof ThesisCriteria>;

/** Deterministic facts supplied to, but never calculated by, the external agentic service. */
export interface GroundingBundle {
  ticker: string;
  companyName: string;
  exchange: string;
  currency: string;
  sector: string | null;
  country: string | null;
  computedMetrics: Record<string, number>;
  dataAsOf: string;
  fundamentals: Record<string, number | string | null>;
}

export class AnalysisValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisValidationError';
  }
}
