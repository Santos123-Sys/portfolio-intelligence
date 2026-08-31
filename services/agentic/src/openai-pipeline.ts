import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z, ZodError } from 'zod';
import { researchCompany, type WebResearchConfig } from './web-research.js';
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

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * The four agents do not benefit equally from reasoning depth, so they no
 * longer have to share one setting. Extraction is close to transcription —
 * it copies stated criteria into a schema and is explicitly forbidden from
 * inferring anything — while discovery and analysis are the stages that carry
 * real judgement. A single global effort therefore either underpowers the
 * judgement stages or overpays on the mechanical one.
 */
export type PipelineStage = 'extraction' | 'analysis' | 'synthesis' | 'discovery';

export type StageReasoningEffort = Record<PipelineStage, ReasoningEffort>;

const PIPELINE_STAGES: PipelineStage[] = ['extraction', 'analysis', 'synthesis', 'discovery'];

/**
 * Accepts either a single effort (applied to every stage, the old behaviour)
 * or a partial per-stage map whose gaps fall back to `fallback`. Keeping the
 * scalar form working means existing callers and tests are unaffected.
 */
export function resolveStageEffort(
  input: ReasoningEffort | Partial<StageReasoningEffort> | undefined,
  fallback: ReasoningEffort = 'medium'
): StageReasoningEffort {
  const base = typeof input === 'string' ? input : fallback;
  const overrides = typeof input === 'object' && input !== null ? input : {};
  return Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [stage, overrides[stage] ?? base])
  ) as StageReasoningEffort;
}

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
//
// thesisVersion is omitted for a related but distinct reason: the service
// already knows it, so asking the model to echo it back adds a way to be wrong
// and no way to be right. Structured outputs constrain shape, not refinements
// — z.number().int().positive() and z.string().uuid() are not enforced by the
// JSON schema the provider validates against, so a garbled version or a
// malformed portfolio UUID passes the provider and fails our parse afterwards,
// as an opaque schema error. Injecting the value the system owns removes the
// class entirely; validateDiscoveryOutput's version check then passes by
// construction, which is the correct outcome for a field the model was never
// entitled to author.
/**
 * The candidate shape as the MODEL is asked to produce it.
 *
 * It exists because DiscoveryCandidate declares ticker, exchange, companyName,
 * currency and rationale as z.string().trim().min(1), and .trim() is a
 * value-changing transform. The OpenAI SDK refuses to represent those in strict
 * Structured Outputs — zodTextFormat throws "value-changing string checks are
 * not represented in JSON Schema" — and it throws while BUILDING the request,
 * before any call is made. Discovery therefore failed 100% of the time with a
 * message about a response that never existed.
 *
 * Dropping .trim() here loses nothing: MarketDiscoveryOutput.parse() runs on
 * the result immediately afterwards and applies the trim as normalisation,
 * which is where it belonged anyway. Every other constraint the contract makes
 * — .min(1), .uuid(), .url(), the score bounds — is still enforced there.
 *
 * discovery-model-schema.test.ts fails if this drifts from the contract's key
 * set, which is the risk a hand-written derived schema carries.
 */
const DiscoveryCandidateModelOutput = z.object({
  portfolioId: z.string(),
  ticker: z.string().min(1),
  exchange: z.string().min(1),
  companyName: z.string().min(1),
  currency: z.string().min(1),
  country: z.string().nullable(),
  sector: z.string().nullable(),
  thesisAlignmentScore: z.number().int().min(0).max(100),
  rationale: z.string().min(1),
  matchedCriteria: z.array(z.string()),
  violatedCriteria: z.array(z.string()),
  groundedIn: z.array(z.string()),
  sourceUrls: z.array(z.string()),
  informationGaps: z.array(z.string()),
}).strict();

export const MarketDiscoveryModelOutput = MarketDiscoveryOutput
  .omit({ verifiedWebSources: true, thesisVersion: true, candidates: true })
  .extend({ candidates: z.array(DiscoveryCandidateModelOutput) });

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

const discoveryInstructions = `You are the final market-research agent for a thesis-driven investment workflow. You receive a confirmed thesis, portfolio mandates, a structurally filtered provider universe, and independently retrieved web-research evidence.

Absolute rules:
1. Select only exact ticker/exchange/company identities present in the supplied universe. Never invent or transform a security identity.
2. Treat the universe as a research universe, not proof of full-market coverage. Disclose important coverage and data gaps in limitations.
3. Use only supplied identity fields, attributes and web-research evidence for candidate eligibility and scoring. Do not calculate or infer new financial metrics.
4. groundedIn contains only exact grounding keys supplied beside that universe record.
5. sourceUrls must include the record's structured-universe source URL. It may additionally include only a URL supplied in the web-research evidence.
6. Preserve hard thesis exclusions. A candidate with an evidenced hard exclusion must not be shortlisted.
7. thesisAlignmentScore measures fit to the confirmed thesis, not general popularity or business quality.
8. Produce exactly one market mandate for every supplied portfolio and no unknown portfolio.
9. Return at most maxCandidatesPerPortfolio candidates for each portfolio. Zero candidates is valid when evidence is insufficient. The intended combined shortlist is 5–15, not a broad universe.
10. Do not value securities, calculate volatility, recommend trades, or alter holdings. Human approval is required before financial analysis.

Prefer decision-useful gaps over generic caveats. A concise, evidence-bound shortlist is better than a long speculative list.`;

export class AgenticPipelineError extends Error {
  constructor(
    readonly stage: PipelineStage,
    message: string,
    /**
     * Whether re-running this job with identical input could plausibly
     * succeed. Jobs fail terminally (postgres-repository.fail sets
     * status='failed'), so nothing here reads this to auto-retry — it exists
     * so the message an operator reads, and any future retry policy, agree
     * with reality instead of assuming every failure is transient.
     */
    readonly retriable = false
  ) {
    super(message);
    this.name = 'AgenticPipelineError';
  }
}

/**
 * Turns a provider or parsing failure into an accurate, non-leaking message.
 *
 * The previous single message claimed every failure "can be retried safely".
 * For a 401, a 403, a 404 on the model name, or a 400 the request will be
 * rejected identically on every attempt — telling an operator to retry sends
 * them in a circle while the real fix (a rotated key, a corrected model name,
 * a schema mismatch) goes unlooked-at.
 *
 * The provider's own error text is deliberately never echoed. That property
 * was the point of the original helper's name and is preserved here: an
 * upstream message can carry request fragments, prompt content, or key
 * material, and this string is persisted to the job row and shown in the UI.
 * Only the class and the HTTP status — neither of which can carry a secret —
 * cross the boundary.
 */
/**
 * A schema failure names the exact fields that were wrong, and that detail was
 * being thrown away: ZodError fell through to classifyProviderError's catch-all
 * and became "the response could not be parsed or validated", which is true and
 * useless. A live discovery run failed with precisely that message and there
 * was no way to tell which field the model had missed without adding logging
 * and reproducing it.
 *
 * Field paths and zod's own messages are safe to surface — they describe the
 * contract, not the data. Received values are deliberately not included: they
 * are model output about securities and can be long.
 */
function describeSchemaFailure(stage: PipelineStage, error: ZodError): AgenticPipelineError {
  const issues = error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  const more = error.issues.length > 6 ? ` (+${error.issues.length - 6} more)` : '';
  return new AgenticPipelineError(
    stage,
    `${stage} output did not match the required schema — ${issues}${more}. ` +
      `This is model output missing the contract; a retry may produce valid output.`,
    true
  );
}

function classifyProviderError(stage: PipelineStage, error: unknown): AgenticPipelineError {
  const fail = (message: string, retriable: boolean) =>
    new AgenticPipelineError(stage, `OpenAI ${stage} request failed: ${message}`, retriable);

  // Terminal: the same request will be rejected the same way every time.
  if (error instanceof AuthenticationError) {
    return fail('the API key was rejected (401). Retrying will not help — rotate OPENAI_API_KEY.', false);
  }
  if (error instanceof PermissionDeniedError) {
    return fail('the key lacks access to this model or endpoint (403). Retrying will not help.', false);
  }
  if (error instanceof NotFoundError) {
    return fail('the model or endpoint was not found (404). Check OPENAI_MODEL; retrying will not help.', false);
  }
  if (error instanceof BadRequestError) {
    return fail('the request was rejected as invalid (400) — usually the output schema or an input limit. Retrying identical input will not help.', false);
  }
  if (error instanceof UnprocessableEntityError) {
    return fail('the request was well-formed but could not be processed (422). Retrying identical input will not help.', false);
  }
  if (error instanceof APIUserAbortError) {
    return fail('the request was aborted before completion.', false);
  }

  // Transient: a later attempt has a real chance.
  if (error instanceof RateLimitError) {
    return fail('the account is rate limited or out of quota (429). Safe to retry after a delay.', true);
  }
  if (error instanceof InternalServerError) {
    return fail('the provider returned a server error (5xx). Safe to retry.', true);
  }
  if (error instanceof APIConnectionTimeoutError) {
    return fail('the request timed out before a response arrived. Safe to retry.', true);
  }
  if (error instanceof APIConnectionError) {
    return fail('the provider could not be reached. Safe to retry.', true);
  }

  // Any other APIError: status is the only reliable signal.
  if (error instanceof APIError) {
    const status = typeof error.status === 'number' ? error.status : 0;
    const retriable = status === 429 || status >= 500;
    return fail(
      `the provider returned HTTP ${status || 'unknown'}. ${retriable ? 'Safe to retry.' : 'Retrying identical input is unlikely to help.'}`,
      retriable
    );
  }

  // Not a provider error at all — most often the response failing its schema.
  // Model output varies between runs, so a retry is worth one attempt, but
  // this is not asserted as safe the way a 429 is.
  // Thrown by zodTextFormat while building the request, so no call was made.
  // Saying "the response could not be parsed" here sent a live investigation
  // looking for a model output that never existed.
  if (error instanceof Error && /cannot be represented by strict Structured Outputs/.test(error.message)) {
    return new AgenticPipelineError(
      stage,
      `${stage} request could not be built: the output schema uses a construct strict ` +
        `Structured Outputs cannot express — ${error.message}. No request was sent, so ` +
        `retrying will not help; the schema itself must change.`,
      false
    );
  }

  return fail(
    'the response could not be parsed or validated. This is usually model output that missed the schema; a retry may produce valid output.',
    true
  );
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

/**
 * The contract types verifiedWebSources as z.array(z.string().url()), and
 * MarketDiscoveryOutput is .strict() — so one malformed string harvested from
 * provider metadata fails the parse and takes the entire discovery run with
 * it, reported as a provider failure it never was. Anything that is not an
 * absolute http(s) URL is therefore dropped here rather than carried forward.
 */
function isHarvestableUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface RetrievedSources {
  urls: string[];
  /** True when the model actually invoked web search. Distinguishes "search
   * never ran" from "search ran and yielded nothing this traversal could
   * read" — the second is how a provider response-shape change would present,
   * and without this flag it looks identical to a quiet, legitimate result. */
  searchInvoked: boolean;
}

export function retrievedSourceUrls(response: unknown): RetrievedSources {
  const urls = new Set<string>();
  let searchInvoked = false;

  const output = (response as { output?: unknown[] })?.output;
  if (!Array.isArray(output)) return { urls: [], searchInvoked };

  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;

    if (record.type === 'web_search_call') {
      searchInvoked = true;
      const action = record.action as Record<string, unknown> | undefined;
      // `action.sources` is the documented location; `results` has appeared on
      // some call shapes. Reading both costs nothing and keeps provenance
      // when only one is populated.
      for (const key of ['sources', 'results'] as const) {
        const collection = action?.[key] ?? record[key];
        if (!Array.isArray(collection)) continue;
        for (const entry of collection) {
          const url = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).url : entry;
          if (isHarvestableUrl(url)) urls.add(url);
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
          if (isHarvestableUrl(url)) urls.add(url);
        }
      }
    }
  }

  return { urls: [...urls], searchInvoked };
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
  private readonly effort: StageReasoningEffort;
  private readonly webResearch: WebResearchConfig;

  constructor(
    apiKey: string,
    private readonly model: string,
    /** A single effort for every stage, or a per-stage map. See
     * resolveStageEffort — the scalar form is the previous behaviour. */
    reasoningEffort: ReasoningEffort | Partial<StageReasoningEffort> = 'medium',
    client?: OpenAI,
    webResearch: WebResearchConfig = { provider: 'none' }
  ) {
    this.effort = resolveStageEffort(reasoningEffort);
    this.client = client ?? new OpenAI({ apiKey, timeout: 180_000, maxRetries: 2 });
    this.webResearch = webResearch;
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
        reasoning: { effort: this.effort.extraction },
        instructions: withOwnerCustomization(extractionInstructions, customization, 'thesis_extraction'),
        input: [{ role: 'user', content }],
        text: { format: zodTextFormat(ExtractionModelOutput, 'thesis_extraction') },
      });
      if (!response.output_parsed) {
        throw new AgenticPipelineError('extraction', 'The model did not return a structured thesis extraction', true);
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
      if (error instanceof ZodError) throw describeSchemaFailure('extraction', error);
      throw classifyProviderError('extraction', error);
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
        reasoning: { effort: this.effort.analysis },
        instructions: withOwnerCustomization(analysisInstructions, customization, 'security_analysis'),
        input: prompt,
        text: { format: zodTextFormat(AnalysisOutput, 'security_analysis') },
      });
      if (!response.output_parsed) {
        throw new AgenticPipelineError('analysis', `No structured analysis was returned for ${bundle.ticker}`, true);
      }
      const output = AnalysisOutput.parse(response.output_parsed);
      if (output.ticker !== bundle.ticker || output.companyName !== bundle.companyName) {
        throw new AgenticPipelineError('analysis', `Security identity changed in output for ${bundle.ticker}`, true);
      }
      validateAnalysisSemantics(output);
      validateGrounding(output, bundle);
      return output;
    } catch (error) {
      if (error instanceof AgenticPipelineError) throw error;
      if (error instanceof ZodError) throw describeSchemaFailure('analysis', error);
      if (error instanceof Error && error.name === 'ContractValidationError') {
        throw new AgenticPipelineError('analysis', `${bundle.ticker}: ${error.message}`, true);
      }
      throw classifyProviderError('analysis', error);
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
        reasoning: { effort: this.effort.synthesis },
        instructions: withOwnerCustomization(synthesisInstructions, customization, 'portfolio_synthesis'),
        input: prompt,
        text: { format: zodTextFormat(ReportSynthesisOutput, 'portfolio_synthesis') },
      });
      if (!response.output_parsed) {
        throw new AgenticPipelineError('synthesis', `No structured synthesis was returned for ${portfolio.name}`, true);
      }
      const output = ReportSynthesisOutput.parse(response.output_parsed);
      validateSynthesisCoverage(output, analyses);
      validateSynthesisEvidence(output, analyses, groundingBundles);
      return output;
    } catch (error) {
      if (error instanceof AgenticPipelineError) throw error;
      if (error instanceof ZodError) throw describeSchemaFailure('synthesis', error);
      if (error instanceof Error && error.name === 'ContractValidationError') {
        throw new AgenticPipelineError('synthesis', `${portfolio.name}: ${error.message}`, true);
      }
      throw classifyProviderError('synthesis', error);
    }
  }

  async discoverSecurities(input: z.infer<typeof DiscoveryRunRequest>): Promise<z.infer<typeof MarketDiscoveryOutput>> {
    const request = DiscoveryRunRequest.parse(input);
    const webEvidence = new Map<string, Awaited<ReturnType<typeof researchCompany>>>();
    // The dashboard supplies no more than 50 structurally-filtered records.
    // Sequential calls make the qualitative research budget explicit and avoid
    // bursting a free-tier search API.
    for (const record of request.universe) {
      webEvidence.set(`${record.exchange}:${record.ticker}`, await researchCompany(record.companyName, record.ticker, this.webResearch));
    }
    const universe = request.universe.map((record) => ({
      ...record,
      groundingKeys: universeGroundingKeys(record),
      webResearch: webEvidence.get(`${record.exchange}:${record.ticker}`),
    }));
    const prompt = `CONFIRMED THESIS\n${JSON.stringify(request.thesis.criteria)}\n\nPORTFOLIOS\n${JSON.stringify(request.portfolios)}\n\nMAX CANDIDATES PER PORTFOLIO\n${request.maxCandidatesPerPortfolio}\n\nSTRUCTURED UNIVERSE\n${JSON.stringify(universe)}`;
    const verifiedWebSources = [...webEvidence.values()].flatMap((evidence) => evidence.urls);
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        reasoning: { effort: this.effort.discovery },
        instructions: withOwnerCustomization(discoveryInstructions, request.agentConfig, 'market_research'),
        input: prompt,
        text: { format: zodTextFormat(MarketDiscoveryModelOutput, 'market_discovery') },
      });
      if (!response.output_parsed) {
        throw new AgenticPipelineError('discovery', 'No structured market-discovery result was returned', true);
      }
      const output = MarketDiscoveryOutput.parse({
        ...response.output_parsed,
        thesisVersion: request.thesis.criteria.version,
        verifiedWebSources,
      });
      validateDiscoveryOutput(output, request);
      return output;
    } catch (error) {
      if (error instanceof AgenticPipelineError) throw error;
      if (error instanceof ZodError) throw describeSchemaFailure('discovery', error);
      if (error instanceof Error && error.name === 'ContractValidationError') {
        throw new AgenticPipelineError('discovery', `Market discovery: ${error.message}`, true);
      }
      throw classifyProviderError('discovery', error);
    }
  }
}
