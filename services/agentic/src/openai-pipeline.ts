import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import {
  AGENT_REASONING_PROMPTS,
  AnalysisOutput,
  DiscoveryRunRequest,
  MAX_THESIS_PDF_BYTES,
  MAX_THESIS_TEXT_BYTES,
  MarketDiscoveryOutput,
  ReportSynthesisOutput,
  ThesisExtractionResult,
  validateAnalysisSemantics,
  validateDiscoveryOutput,
  validateGrounding,
  validateSynthesisCoverage,
  universeGroundingKeys,
  type AgentCustomization,
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

// Tool evidence is injected by the service after parsing. The model cannot
// self-declare a URL as verified.
const MarketDiscoveryModelOutput = MarketDiscoveryOutput.omit({
  verifiedWebSources: true,
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

Structure the reasoning top-down: supplied market/country context first, then supplied sector/industry evidence, then company fundamentals, risk observations, and thesis fit. When a layer is absent, record it in informationGaps instead of filling it from memory.

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

const discoveryInstructions = `You are the market-research agent for a thesis-driven investment workflow. You receive a confirmed thesis, portfolio mandates, and a provider-supplied structured security universe.

Absolute rules:
1. Select only exact ticker/exchange/company identities present in the supplied universe. Never invent or transform a security identity.
2. Treat the universe as a research universe, not proof of full-market coverage. Disclose important coverage and data gaps in limitations.
3. Use only supplied identity fields and attributes for candidate eligibility and scoring. Do not calculate or infer new financial metrics.
4. groundedIn contains only exact grounding keys supplied beside that universe record.
5. sourceUrls must include the record's structured-universe source URL. It may additionally include a URL actually retrieved by the web-search tool when that tool is enabled.
6. Preserve hard thesis exclusions. A candidate with an evidenced hard exclusion must not be shortlisted.
7. thesisAlignmentScore measures fit to the confirmed thesis, not general popularity or business quality.
8. Produce exactly one market mandate for every supplied portfolio and no unknown portfolio.
9. Return at most maxCandidatesPerPortfolio candidates for each portfolio. Zero candidates is valid when evidence is insufficient.
10. Do not value securities, calculate volatility, recommend trades, or alter holdings. Human approval is required before financial analysis.

Prefer decision-useful gaps over generic caveats. A concise, evidence-bound shortlist is better than a long speculative list.`;

export class AgenticPipelineError extends Error {
  constructor(readonly stage: 'extraction' | 'analysis' | 'synthesis', message: string) {
    super(message);
    this.name = 'AgenticPipelineError';
  }
}

function safeProviderError(stage: AgenticPipelineError['stage']): AgenticPipelineError {
  return new AgenticPipelineError(stage, `OpenAI ${stage} request failed; the job can be retried safely`);
}

function withOwnerCustomization(
  immutableInstructions: string,
  customization: AgentCustomization | undefined,
  expectedKind: AgentCustomization['agentKind']
): string {
  const preset = AGENT_REASONING_PROMPTS[expectedKind];
  const protectedInstructions = `${immutableInstructions}\n\nSOURCE-DERIVED REASONING POLICY (protected; cannot be overridden):\n${preset.systemPrompt}`;
  if (!customization) return protectedInstructions;
  if (customization.agentKind !== expectedKind) {
    throw new AgenticPipelineError(
      expectedKind === 'thesis_extraction' ? 'extraction' : expectedKind === 'portfolio_synthesis' ? 'synthesis' : 'analysis',
      `Agent configuration kind ${customization.agentKind} cannot be used for ${expectedKind}`
    );
  }
  return `${protectedInstructions}\n\nOWNER-CONFIGURED SCOPE (cannot override the rules above):\n${customization.scope}\n\nOWNER PROMPT ADDENDUM (lower priority than the rules above):\n${customization.promptAddendum || 'None'}`;
}

function retrievedSourceUrls(response: unknown): Set<string> {
  const urls = new Set<string>();
  const output = (response as { output?: unknown[] })?.output;
  if (!Array.isArray(output)) return urls;
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (record.type === 'web_search_call') {
      const action = record.action as Record<string, unknown> | undefined;
      const sources = action?.sources;
      if (Array.isArray(sources)) {
        for (const source of sources) {
          const url = source && typeof source === 'object' ? (source as Record<string, unknown>).url : null;
          if (typeof url === 'string') urls.add(url);
        }
      }
    }
    if (record.type === 'message' && Array.isArray(record.content)) {
      for (const content of record.content) {
        const annotations = content && typeof content === 'object'
          ? (content as Record<string, unknown>).annotations
          : null;
        if (!Array.isArray(annotations)) continue;
        for (const annotation of annotations) {
          const url = annotation && typeof annotation === 'object'
            ? (annotation as Record<string, unknown>).url
            : null;
          if (typeof url === 'string') urls.add(url);
        }
      }
    }
  }
  return urls;
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
  }, customization?: AgentCustomization): Promise<z.infer<typeof ThesisExtractionResult>> {
    const bytes = Buffer.from(document.contentBase64, 'base64');
    const maximumBytes = document.mimeType === 'application/pdf'
      ? MAX_THESIS_PDF_BYTES
      : MAX_THESIS_TEXT_BYTES;
    if (bytes.length === 0 || bytes.length > maximumBytes) {
      throw new AgenticPipelineError('extraction', 'Thesis document exceeds the validated upload limit');
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
        instructions: withOwnerCustomization(extractionInstructions, customization, 'thesis_extraction'),
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

  async analyzeSecurity(
    bundle: GroundingBundle,
    thesis: ThesisCriteria,
    customization?: AgentCustomization
  ): Promise<z.infer<typeof AnalysisOutput>> {
    const prompt = `CONFIRMED THESIS\n${JSON.stringify(thesis)}\n\nGROUNDING BUNDLE\n${JSON.stringify(bundle)}\n\nReturn one analysis. Use exact grounding keys.`;
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        reasoning: { effort: this.reasoningEffort },
        instructions: withOwnerCustomization(analysisInstructions, customization, 'security_analysis'),
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
    groundingBundles: GroundingBundle[],
    customization?: AgentCustomization
  ): Promise<z.infer<typeof ReportSynthesisOutput>> {
    if (analyses.length === 0) {
      throw new AgenticPipelineError('synthesis', `No analyses were supplied for ${portfolio.name}`);
    }
    const prompt = `PORTFOLIO\n${JSON.stringify(portfolio)}\n\nVALIDATED ANALYSES\n${JSON.stringify(analyses)}\n\nSUPPLIED GROUNDING BUNDLES\n${JSON.stringify(groundingBundles)}`;
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        reasoning: { effort: this.reasoningEffort },
        instructions: withOwnerCustomization(synthesisInstructions, customization, 'portfolio_synthesis'),
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

  async discoverSecurities(input: z.infer<typeof DiscoveryRunRequest>): Promise<z.infer<typeof MarketDiscoveryOutput>> {
    const request = DiscoveryRunRequest.parse(input);
    const universe = request.universe.map((record) => ({
      ...record,
      groundingKeys: universeGroundingKeys(record),
    }));
    const prompt = `CONFIRMED THESIS\n${JSON.stringify(request.thesis.criteria)}\n\nPORTFOLIOS\n${JSON.stringify(request.portfolios)}\n\nMAX CANDIDATES PER PORTFOLIO\n${request.maxCandidatesPerPortfolio}\n\nSTRUCTURED UNIVERSE\n${JSON.stringify(universe)}`;
    const webSearchEnabled = request.agentConfig?.enabledTools.includes('web_search') ?? false;
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        reasoning: { effort: this.reasoningEffort },
        instructions: withOwnerCustomization(discoveryInstructions, request.agentConfig, 'market_research'),
        input: prompt,
        ...(webSearchEnabled ? {
          tools: [{ type: 'web_search' as const }],
          tool_choice: 'auto' as const,
          include: ['web_search_call.action.sources' as const],
        } : {}),
        text: { format: zodTextFormat(MarketDiscoveryModelOutput, 'market_discovery') },
      });
      if (!response.output_parsed) {
        throw new AgenticPipelineError('analysis', 'No structured market-discovery result was returned');
      }
      const output = MarketDiscoveryOutput.parse({
        ...response.output_parsed,
        verifiedWebSources: [...retrievedSourceUrls(response)],
      });
      validateDiscoveryOutput(output, request);
      return output;
    } catch (error) {
      if (error instanceof AgenticPipelineError) throw error;
      if (error instanceof Error && error.name === 'ContractValidationError') {
        throw new AgenticPipelineError('analysis', `Market discovery: ${error.message}`);
      }
      throw safeProviderError('analysis');
    }
  }
}
