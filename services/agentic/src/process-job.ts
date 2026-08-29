import {
  AgenticRunRequest,
  DiscoveryRunRequest,
  ThesisExtractionRequest,
  validateRunRequestCoherence,
  type AnalysisOutput,
  type ReportSynthesisOutput,
} from '@portfolio-intelligence/agentic-contract';
import { buildManifest, hashManifest } from './manifest.js';
import { AgenticPipelineError, OpenAIAgenticPipeline } from './openai-pipeline.js';
import { renderReportPdf } from './pdf.js';
import type { ReportStorage } from './storage.js';
import type { AgenticJob, JobRepository } from './types.js';

export interface ProcessingDependencies {
  repository: JobRepository;
  pipeline: Pick<OpenAIAgenticPipeline, 'extractThesis' | 'discoverSecurities' | 'analyzeSecurity' | 'synthesizePortfolio'>;
  storage: Pick<ReportStorage, 'put'>;
  renderPdf?: typeof renderReportPdf;
}

export async function processJob(job: AgenticJob, deps: ProcessingDependencies): Promise<void> {
  try {
    if (job.kind === 'thesis_extraction') {
      const request = ThesisExtractionRequest.safeParse(job.payload);
      if (!request.success) throw new AgenticPipelineError('extraction', 'Stored thesis payload failed contract validation');
      await deps.repository.updateProgress(job.id, 0, 1, 'thesis_extraction');
      const result = await deps.pipeline.extractThesis(request.data.document, request.data.agentConfig);
      await deps.repository.completeExtraction(job.id, result);
      return;
    }

    if (job.kind === 'market_discovery') {
      const request = DiscoveryRunRequest.safeParse(job.payload);
      if (!request.success) throw new AgenticPipelineError('analysis', 'Stored discovery payload failed contract validation');
      await deps.repository.updateProgress(job.id, 0, 1, 'market_discovery');
      const result = await deps.pipeline.discoverSecurities(request.data);
      await deps.repository.completeDiscovery(job.id, result);
      return;
    }

    const request = AgenticRunRequest.safeParse(job.payload);
    if (!request.success) throw new AgenticPipelineError('analysis', 'Stored run payload failed contract validation');
    validateRunRequestCoherence(request.data);

    const total = request.data.securities.length + request.data.portfolios.length + 2;
    let completed = 0;
    const results: Array<{
      portfolioId: string;
      analyses: AnalysisOutput[];
      synthesis: ReportSynthesisOutput;
    }> = [];

    for (const portfolio of request.data.portfolios) {
      const securities = request.data.securities.filter((security) => security.portfolioId === portfolio.id);
      if (securities.length === 0) {
        throw new AgenticPipelineError('analysis', `Portfolio ${portfolio.id} has no requested securities`);
      }
      const analyses: AnalysisOutput[] = [];
      const bundles = [];
      for (const security of securities) {
        await deps.repository.updateProgress(job.id, completed, total, `security_analysis:${security.ticker}`);
        const grounding = request.data.groundingBundles.find(({ portfolioId, bundle }) =>
          portfolioId === portfolio.id && bundle.ticker === security.ticker && bundle.exchange === security.exchange
        );
        if (!grounding) throw new AgenticPipelineError('analysis', `Grounding bundle missing for ${security.ticker}`);
        analyses.push(await deps.pipeline.analyzeSecurity(
          grounding.bundle,
          request.data.thesis.criteria,
          request.data.agentConfigs?.find((config) => config.agentKind === 'security_analysis')
        ));
        bundles.push(grounding.bundle);
        completed += 1;
      }

      await deps.repository.updateProgress(job.id, completed, total, `portfolio_synthesis:${portfolio.id}`);
      const synthesis = await deps.pipeline.synthesizePortfolio(
        portfolio,
        analyses,
        bundles,
        request.data.agentConfigs?.find((config) => config.agentKind === 'portfolio_synthesis')
      );
      results.push({ portfolioId: portfolio.id, analyses, synthesis });
      completed += 1;
    }

    await deps.repository.updateProgress(job.id, completed, total, 'manifest_validation');
    const manifest = buildManifest(request.data, results);
    completed += 1;

    await deps.repository.updateProgress(job.id, completed, total, 'report_render');
    let pdf: Buffer;
    try {
      pdf = await (deps.renderPdf ?? renderReportPdf)(manifest, job.externalId);
    } catch {
      throw new ProcessingStageError('render', 'PDF report rendering failed; the job can be retried safely');
    }

    let report;
    try {
      report = await deps.storage.put(job.externalId, pdf);
    } catch {
      throw new ProcessingStageError('upload', 'PDF artifact upload failed; the job can be retried safely');
    }
    await deps.repository.completeAnalysis(job.id, manifest, hashManifest(manifest), report);
  } catch (error) {
    const stage = error instanceof AgenticPipelineError || error instanceof ProcessingStageError
      ? error.stage
      : job.kind === 'thesis_extraction' ? 'extraction' : 'analysis';
    const safeMessage = error instanceof AgenticPipelineError || error instanceof ProcessingStageError
      ? error.message
      : 'Agentic job failed unexpectedly; no security was silently omitted';
    await deps.repository.fail(job.id, stage, safeMessage);
  }
}

class ProcessingStageError extends Error {
  constructor(readonly stage: 'render' | 'upload', message: string) {
    super(message);
    this.name = 'ProcessingStageError';
  }
}
