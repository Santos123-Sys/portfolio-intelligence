import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import {
  AnalysisOutput,
  ReportSynthesisOutput,
  ThesisExtractionResult,
  validateAnalysisSemantics,
  validateGrounding,
  validateSynthesisCoverage,
  type GroundingBundle,
  type ThesisCriteria,
} from '@portfolio-intelligence/agentic-contract';

type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

const ExtractionModelOutput = z.object({
  criteria: z.object({
    version: z.number().int().positive(),
    portfolios: z.array(z.object({
      role: z.enum(['swiss_quality', 'brazilian_growth', 'fixed_income', 'not_suitable']),
      currency: z.string().min(1),
      objective: z.string().min(1),
      inclusionCriteria: z.array(z.string()),
      exclusionCriteria: z.array(z.string()),
      targetMetrics: z.array(z.object({ name: z.string(), value: z.string() })),
    })).min(1),
    globalConstraints: z.array(z.string()),
  }),
  extractionConfidence: z.number().min(0).max(1),
  ambiguousPoints: z.array(z.object({
    location: z.string(),
    issue: z.string(),
    sourceExcerpt: z.string(),
  })),
  unmappedContent: z.array(z.string()),
});

const extractionInstructions = `You extract a human-authored investment thesis into structured data for human review.

Rules:
- Extract only what is stated or unambiguously implied. Never invent a criterion or numeric threshold.
- Preserve hard exclusions as exclusions and preferences as inclusion criteria. If severity is ambiguous, record it only in ambiguousPoints.
- A metric without a numeric threshold belongs in ambiguousPoints, not targetMetrics.
- Produce one portfolio entry per distinct role. Never merge separate portfolios.
- Put cross-portfolio constraints in globalConstraints.
- Preserve substantive content that cannot be mapped in unmappedContent.
- Set criteria.version to the version explicitly supplied by the caller.
- Keep sourceExcerpt short and verbatim from the submitted document.
- targetMetrics is required by the output schema; use an empty array when none are explicit and one name/value item per explicit threshold.
- Do not evaluate securities, calculate metrics, or give investment advice.`;

const analysisInstructions = `You are the sole investment-analysis language model in this system. You interpret one dashboard-supplied grounding bundle against a confirmed investment thesis. You do not fetch data or calculate metrics.

Absolute rules:
1. Use only values present in computedMetrics or fundamentals. Do not calculate, transform, annualize, estimate, or infer a new numeric value.
2. groundedIn must contain exact object keys from computedMetrics or fundamentals. List every supplied field that materially supports a conclusion.
3. Missing relevant facts or metrics go in informationGaps. confidenceScore measures data completeness, not conviction.
4. riskScore is 0 for minimal risk and 100 for severe risk.
5. thesisAlignmentScore measures fit to the supplied thesis, not general business quality. A strong company can have low alignment.
6. If thesisAlignmentScore is below 45, investmentScore must be no more than thesisAlignmentScore + 15.
7. A hard exclusion must keep portfolioCandidate false and must appear in thesisBreakers.
8. investmentThesis must contain two labeled sections in the same string: "Affirmative case:" and "Strongest counter-case:".
9. keyCatalysts, keyRisks, and thesisBreakers must each contain at least one concrete item. If no thesis breaker is currently evidenced, state the most decision-relevant future condition that would break the thesis without inventing a threshold.
10. Use professional, concise buy-side language. No generic claims without a supplied field behind them.

Score quality, growth, dividend characteristics, risk severity, and thesis alignment independently on a 0–100 scale. investmentScore is a thesis-aware judgment, not a calculated average.`;

const synthesisInstructions = `Write a portfolio memo from already validated security analyses and their supplied grounding bundles.

Rules:
- Cover every supplied security exactly once in perSecurityNarratives. Introduce no other ticker.
- Do not re-score, upgrade, soften, or contradict an individual analysis.
- Preserve low confidence and every material information gap.
- concentrationFlags may use only dashboard-supplied position-weight fields in the grounding bundles. If no weights are supplied, state that concentration could not be assessed.
- watchlistAndViolations may use only portfolioCandidate flags and thesisBreakers from the analyses.
- Every watchlist or violation item must name the ticker it derives from.
- groundedIn contains only input ticker strings and must be non-empty.
- The disclaimer must plainly say the output is analytical, is not professional financial advice, and depends on supplied data.
- Do not add facts from general knowledge and do not calculate anything.`;

export class AgenticPipelineError extends Error {
  constructor(readonly stage: 'extraction' | 'analysis' | 'synthesis', message: string) {
    super(message);
    this.name = 'AgenticPipelineError';
  }
}

function safeProviderError(stage: AgenticPipelineError['stage']): AgenticPipelineError {
  return new AgenticPipelineError(stage, `OpenAI ${stage} request failed; the job can be retried safely`);
}

export interface PortfolioInput {
  id: string;
  name: string;
  baseCurrency: string;
  investmentObjective: string;
}

export function validateSynthesisEvidence(
  output: z.infer<typeof ReportSynthesisOutput>,
  analyses: z.infer<typeof AnalysisOutput>[],
  bundles: GroundingBundle[]
): void {
  const tickerSet = new Set(analyses.map((analysis) => analysis.ticker));
  const ungroundedWatchlist = output.watchlistAndViolations.filter((item) =>
    ![...tickerSet].some((ticker) => item.includes(ticker))
  );
  if (ungroundedWatchlist.length) {
    throw new AgenticPipelineError('synthesis', 'Every watchlist item must name a supplied ticker');
  }

  const suppliedWeights = bundles.flatMap((bundle) =>
    Object.entries(bundle.computedMetrics)
      .filter(([key]) => key.startsWith('position:weight:'))
      .map(([, value]) => String(value))
  );
  const citedNumbers = output.concentrationFlags.flatMap((flag) => flag.match(/\b\d+(?:\.\d+)?\b/g) ?? []);
  const invented = citedNumbers.filter((number) => !suppliedWeights.includes(number));
  if (invented.length) {
    throw new AgenticPipelineError(
      'synthesis',
      `Concentration flags cite values absent from supplied position weights: ${invented.join(', ')}`
    );
  }
}

export class OpenAIAgenticPipeline {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly reasoningEffort: ReasoningEffort = 'medium',
    client?: OpenAI
  ) {
    this.client = client ?? new OpenAI({ apiKey, timeout: 180_000, maxRetries: 2 });
  }

  async extractThesis(document: {
    version: number;
    fileName: string;
    mimeType: 'application/pdf' | 'text/plain' | 'text/markdown';
    contentBase64: string;
  }): Promise<z.infer<typeof ThesisExtractionResult>> {
    const bytes = Buffer.from(document.contentBase64, 'base64');
    if (bytes.length === 0 || bytes.length > 50 * 1024 * 1024) {
      throw new AgenticPipelineError('extraction', 'Thesis document must contain 1 byte to 50 MB');
    }

    const content = document.mimeType === 'application/pdf'
      ? [{
          type: 'input_file' as const,
          filename: document.fileName,
          file_data: `data:application/pdf;base64,${document.contentBase64}`,
        }, {
          type: 'input_text' as const,
          text: `The canonical thesis version is ${document.version}. Extract the attached document.`,
        }]
      : [{
          type: 'input_text' as const,
          text: `The canonical thesis version is ${document.version}.\n\nSOURCE DOCUMENT:\n${bytes.toString('utf8')}`,
        }];

    try {
      const response = await this.client.responses.parse({
        model: this.model,
        reasoning: { effort: this.reasoningEffort },
        instructions: extractionInstructions,
        input: [{ role: 'user', content }],
        text: { format: zodTextFormat(ExtractionModelOutput, 'thesis_extraction') },
      });
      if (!response.output_parsed) {
        throw new AgenticPipelineError('extraction', 'The model did not return a structured thesis extraction');
      }
      const normalized = {
        ...response.output_parsed,
        criteria: {
          ...response.output_parsed.criteria,
          version: document.version,
          portfolios: response.output_parsed.criteria.portfolios.map((portfolio) => ({
            ...portfolio,
            targetMetrics: portfolio.targetMetrics.length
              ? Object.fromEntries(portfolio.targetMetrics.map((metric) => [metric.name, metric.value]))
              : undefined,
          })),
        },
      };
      return ThesisExtractionResult.parse(normalized);
    } catch (error) {
      if (error instanceof AgenticPipelineError) throw error;
      throw safeProviderError('extraction');
    }
  }

  async analyzeSecurity(bundle: GroundingBundle, thesis: ThesisCriteria): Promise<z.infer<typeof AnalysisOutput>> {
    const prompt = `CONFIRMED THESIS\n${JSON.stringify(thesis)}\n\nGROUNDING BUNDLE\n${JSON.stringify(bundle)}\n\nReturn one analysis. Use exact grounding keys.`;
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        reasoning: { effort: this.reasoningEffort },
        instructions: analysisInstructions,
        input: prompt,
        text: { format: zodTextFormat(AnalysisOutput, 'security_analysis') },
      });
      if (!response.output_parsed) {
        throw new AgenticPipelineError('analysis', `No structured analysis was returned for ${bundle.ticker}`);
      }
      const output = AnalysisOutput.parse(response.output_parsed);
      if (output.ticker !== bundle.ticker || output.companyName !== bundle.companyName) {
        throw new AgenticPipelineError('analysis', `Security identity changed in output for ${bundle.ticker}`);
      }
      validateAnalysisSemantics(output);
      validateGrounding(output, bundle);
      return output;
    } catch (error) {
      if (error instanceof AgenticPipelineError) throw error;
      if (error instanceof Error && error.name === 'ContractValidationError') {
        throw new AgenticPipelineError('analysis', `${bundle.ticker}: ${error.message}`);
      }
      throw safeProviderError('analysis');
    }
  }

  async synthesizePortfolio(
    portfolio: PortfolioInput,
    analyses: z.infer<typeof AnalysisOutput>[],
    groundingBundles: GroundingBundle[]
  ): Promise<z.infer<typeof ReportSynthesisOutput>> {
    if (analyses.length === 0) {
      throw new AgenticPipelineError('synthesis', `No analyses were supplied for ${portfolio.name}`);
    }
    const prompt = `PORTFOLIO\n${JSON.stringify(portfolio)}\n\nVALIDATED ANALYSES\n${JSON.stringify(analyses)}\n\nSUPPLIED GROUNDING BUNDLES\n${JSON.stringify(groundingBundles)}`;
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        reasoning: { effort: this.reasoningEffort },
        instructions: synthesisInstructions,
        input: prompt,
        text: { format: zodTextFormat(ReportSynthesisOutput, 'portfolio_synthesis') },
      });
      if (!response.output_parsed) {
        throw new AgenticPipelineError('synthesis', `No structured synthesis was returned for ${portfolio.name}`);
      }
      const output = ReportSynthesisOutput.parse(response.output_parsed);
      validateSynthesisCoverage(output, analyses);
      validateSynthesisEvidence(output, analyses, groundingBundles);
      return output;
    } catch (error) {
      if (error instanceof AgenticPipelineError) throw error;
      if (error instanceof Error && error.name === 'ContractValidationError') {
        throw new AgenticPipelineError('synthesis', `${portfolio.name}: ${error.message}`);
      }
      throw safeProviderError('synthesis');
    }
  }
}
