import { z } from 'zod';
import { AnalysisOutput, PortfolioRole } from './schemas';

const score = z.number().int().min(0).max(100);

export const ThesisInterpretation = z.object({
  mandate: PortfolioRole,
  objective: z.string().min(1),
  inclusionCriteria: z.array(z.string()),
  exclusionCriteria: z.array(z.string()),
  relevantConstraints: z.array(z.string()),
  rationale: z.string().min(1),
});

export const EvidenceReview = z.object({
  evidenceUsed: z.array(z.string()).min(1),
  missingInformation: z.array(z.string()),
  staleOrConflictingEvidence: z.array(z.string()),
  evidenceSummary: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const FundamentalAssessment = z.object({
  qualityScore: score,
  growthScore: score,
  dividendScore: score,
  balanceSheetAssessment: z.string().min(1),
  profitabilityAssessment: z.string().min(1),
  competitivePosition: z.string().min(1),
  reinvestmentAssessment: z.string().min(1),
  supportingEvidence: z.array(z.string()).min(1),
  gaps: z.array(z.string()),
});

export const RiskInterpretation = z.object({
  riskScore: score,
  riskSummary: z.string().min(1),
  keyRiskSignals: z.array(z.string()).min(1),
  methodologyCaveats: z.array(z.string()),
  groundedMetrics: z.array(z.string()).min(1),
});

export const PortfolioFitAssessment = z.object({
  portfolioRole: PortfolioRole,
  thesisAlignmentScore: score,
  fitsMandate: z.boolean(),
  supportingFactors: z.array(z.string()),
  contradictingFactors: z.array(z.string()),
  roleRationale: z.string().min(1),
});

export const CriticAssessment = z.object({
  strongestCounterCase: z.string().min(1),
  unsupportedAssumptions: z.array(z.string()),
  reasonsToRejectOrDefer: z.array(z.string()),
  thesisBreakers: z.array(z.string()).min(1),
  dataGaps: z.array(z.string()),
  severity: z.enum(['low', 'medium', 'high']),
});

export const CommitteeDecision = AnalysisOutput.extend({
  committeeSummary: z.string().min(1),
  criticIncorporated: z.boolean(),
});

export const AgenticTrace = z.object({
  thesis: ThesisInterpretation,
  evidence: EvidenceReview,
  fundamentals: FundamentalAssessment,
  risk: RiskInterpretation,
  portfolioFit: PortfolioFitAssessment,
  critic: CriticAssessment,
  committee: CommitteeDecision,
});

export type ThesisInterpretation = z.infer<typeof ThesisInterpretation>;
export type EvidenceReview = z.infer<typeof EvidenceReview>;
export type FundamentalAssessment = z.infer<typeof FundamentalAssessment>;
export type RiskInterpretation = z.infer<typeof RiskInterpretation>;
export type PortfolioFitAssessment = z.infer<typeof PortfolioFitAssessment>;
export type CriticAssessment = z.infer<typeof CriticAssessment>;
export type CommitteeDecision = z.infer<typeof CommitteeDecision>;
export type AgenticTrace = z.infer<typeof AgenticTrace>;
