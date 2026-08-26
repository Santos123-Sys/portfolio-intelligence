import { z } from 'zod';
import { AnalysisOutput, PortfolioRole, ThesisCriteria } from '@/lib/agenteki/schemas';

const synthesis = z.object({
  executiveSummary: z.string().min(1),
  thematicHighlights: z.array(z.string()),
  concentrationFlags: z.array(z.string()),
  perSecurityNarratives: z.array(z.object({
    ticker: z.string().min(1),
    narrative: z.string().min(1),
  })),
  watchlistAndViolations: z.array(z.string()),
  disclaimer: z.string().min(1),
  groundedIn: z.array(z.string()).min(1),
});

export const ReportSynthesisOutput = synthesis;
export type ReportSynthesisOutput = z.infer<typeof synthesis>;

const portfolioManifest = z.object({
  portfolioId: z.string().uuid(),
  name: z.string().min(1),
  baseCurrency: z.string().min(1),
  analyses: z.array(AnalysisOutput),
  synthesis,
});

export const PortfolioAnalysisManifest = z.object({
  schemaVersion: z.string().default('1.0'),
  generatedAt: z.string().datetime(),
  thesisVersion: z.number().int().positive(),
  portfolios: z.array(portfolioManifest).min(1),
});

export type PortfolioAnalysisManifest = z.infer<typeof PortfolioAnalysisManifest>;

export const AgenticImportRequest = z.object({
  externalRunId: z.string().min(1),
  status: z.enum(['completed', 'failed']).default('completed'),
  manifest: PortfolioAnalysisManifest,
  reportPdfUrl: z.string().url().optional(),
});

export type AgenticImportRequest = z.infer<typeof AgenticImportRequest>;

export const AgenticRunRequest = z.object({
  thesis: z.object({
    versionId: z.string().uuid().optional(),
    criteria: ThesisCriteria,
  }),
  securities: z.array(z.object({
    ticker: z.string().min(1),
    exchange: z.string().min(1),
    portfolioId: z.string().uuid(),
  })).min(1),
  portfolios: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    baseCurrency: z.string().min(1),
    investmentObjective: z.string(),
  })).min(1),
});

export type AgenticRunRequest = z.infer<typeof AgenticRunRequest>;

export const ExternalRunStatus = z.object({
  externalRunId: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'imported']),
  manifest: PortfolioAnalysisManifest.optional(),
  reportPdfUrl: z.string().url().optional(),
  errorMessage: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type ExternalRunStatus = z.infer<typeof ExternalRunStatus>;
