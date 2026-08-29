import { createHash, randomUUID } from 'node:crypto';
import {
  MANIFEST_SCHEMA_VERSION,
  PortfolioAnalysisManifest,
  stableStringify,
  validateManifestAgainstRequest,
  type AgenticRunRequest,
  type AnalysisOutput,
  type ReportSynthesisOutput,
} from '@portfolio-intelligence/agentic-contract';

export function createExternalId(kind: 'run' | 'extraction' | 'discovery', now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const prefix = kind === 'run' ? 'agent-run' : kind === 'extraction' ? 'thesis-extraction' : 'market-discovery';
  return `${prefix}-${timestamp}-${randomUUID()}`;
}

export function buildManifest(
  request: AgenticRunRequest,
  results: Array<{
    portfolioId: string;
    analyses: AnalysisOutput[];
    synthesis: ReportSynthesisOutput;
  }>,
  generatedAt = new Date()
) {
  const byPortfolio = new Map(results.map((result) => [result.portfolioId, result]));
  const manifest = PortfolioAnalysisManifest.parse({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    thesisVersion: request.thesis.criteria.version,
    portfolios: request.portfolios.map((portfolio) => {
      const result = byPortfolio.get(portfolio.id);
      if (!result) throw new Error(`Missing synthesis for portfolio ${portfolio.id}`);
      return {
        portfolioId: portfolio.id,
        name: portfolio.name,
        baseCurrency: portfolio.baseCurrency,
        analyses: result.analyses,
        synthesis: result.synthesis,
      };
    }),
  });
  validateManifestAgainstRequest(manifest, request);
  return manifest;
}

export function hashManifest(manifest: PortfolioAnalysisManifest): string {
  return createHash('sha256').update(stableStringify(manifest)).digest('hex');
}
