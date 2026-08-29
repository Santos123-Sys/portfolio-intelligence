import { z } from 'zod';

export const MANIFEST_SCHEMA_VERSION = '1.0' as const;

export const PortfolioRole = z.enum([
  'swiss_quality',
  'brazilian_growth',
  'fixed_income',
  'not_suitable',
]);
export type PortfolioRole = z.infer<typeof PortfolioRole>;

export const AgentKind = z.enum([
  'thesis_extraction',
  'market_research',
  'security_analysis',
  'portfolio_synthesis',
]);
export type AgentKind = z.infer<typeof AgentKind>;

export const AgentTool = z.enum([
  'thesis_document',
  'structured_universe',
  'web_search',
  'grounding_bundle',
]);
export type AgentTool = z.infer<typeof AgentTool>;

/**
 * Owner-configurable instructions are always appended to immutable service
 * policy. They can narrow an agent's scope, but cannot remove grounding,
 * calculation, ownership, or no-trading constraints.
 */
export const AgentCustomization = z.object({
  agentKind: AgentKind,
  configVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  scope: z.string().trim().min(1).max(2_000),
  promptAddendum: z.string().trim().max(4_000),
  enabledTools: z.array(AgentTool).max(4),
}).strict();
export type AgentCustomization = z.infer<typeof AgentCustomization>;

const score = z.number().int().min(0).max(100);

export const ThesisPortfolioCriteria = z.object({
  role: PortfolioRole,
  currency: z.string().min(1),
  objective: z.string().min(1),
  inclusionCriteria: z.array(z.string()),
  exclusionCriteria: z.array(z.string()),
  targetMetrics: z.record(z.string(), z.string()).optional(),
}).strict();

export const ThesisCriteria = z.object({
  version: z.number().int().positive(),
  portfolios: z.array(ThesisPortfolioCriteria).min(1),
  globalConstraints: z.array(z.string()),
}).strict();
export type ThesisCriteria = z.infer<typeof ThesisCriteria>;

export const ThesisExtractionResult = z.object({
  criteria: ThesisCriteria,
  extractionConfidence: z.number().min(0).max(1),
  ambiguousPoints: z.array(z.object({
    location: z.string(),
    issue: z.string(),
    sourceExcerpt: z.string(),
  })),
  unmappedContent: z.array(z.string()),
}).strict();
export type ThesisExtractionResult = z.infer<typeof ThesisExtractionResult>;

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
}).strict();
export type AnalysisOutput = z.infer<typeof AnalysisOutput>;

export const GroundingBundle = z.object({
  ticker: z.string().min(1),
  companyName: z.string().min(1),
  exchange: z.string().min(1),
  currency: z.string().min(1),
  sector: z.string().nullable(),
  country: z.string().nullable(),
  computedMetrics: z.record(z.string(), z.number()),
  dataAsOf: z.string().datetime(),
  fundamentals: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
}).strict();
export type GroundingBundle = z.infer<typeof GroundingBundle>;

export const ReportSynthesisOutput = z.object({
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
}).strict();
export type ReportSynthesisOutput = z.infer<typeof ReportSynthesisOutput>;

export const PortfolioManifest = z.object({
  portfolioId: z.string().uuid(),
  name: z.string().min(1),
  baseCurrency: z.string().min(1),
  analyses: z.array(AnalysisOutput).min(1),
  synthesis: ReportSynthesisOutput,
}).strict();

export const PortfolioAnalysisManifest = z.object({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  generatedAt: z.string().datetime(),
  thesisVersion: z.number().int().positive(),
  portfolios: z.array(PortfolioManifest).min(1),
}).strict();
export type PortfolioAnalysisManifest = z.infer<typeof PortfolioAnalysisManifest>;

export const AgenticRunRequest = z.object({
  thesis: z.object({
    versionId: z.string().uuid(),
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
  groundingBundles: z.array(z.object({
    portfolioId: z.string().uuid(),
    bundle: GroundingBundle,
  })).min(1),
  origin: z.object({
    kind: z.enum(['portfolio_monitoring', 'discovery_candidate']),
    candidateId: z.string().uuid().optional(),
  }).strict().optional(),
  agentConfigs: z.array(AgentCustomization).max(2).optional(),
}).strict().superRefine((request, context) => {
  if (request.origin?.kind === 'discovery_candidate' && !request.origin.candidateId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['origin', 'candidateId'],
      message: 'Discovery-candidate analysis requires candidateId',
    });
  }
  const allowed = new Set(['security_analysis', 'portfolio_synthesis']);
  if (request.agentConfigs?.some((config) => !allowed.has(config.agentKind))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['agentConfigs'],
      message: 'Analysis runs accept only security_analysis and portfolio_synthesis configurations',
    });
  }
});
export type AgenticRunRequest = z.infer<typeof AgenticRunRequest>;

const universeScalar = z.union([z.number().finite(), z.string(), z.boolean(), z.null()]);

export const SecurityUniverseRecord = z.object({
  ticker: z.string().trim().min(1),
  exchange: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  currency: z.string().trim().min(1),
  country: z.string().nullable(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  assetType: z.string().trim().min(1),
  observedAt: z.string().datetime(),
  provider: z.string().trim().min(1),
  sourceUrl: z.string().url(),
  attributes: z.record(z.string(), universeScalar),
}).strict();
export type SecurityUniverseRecord = z.infer<typeof SecurityUniverseRecord>;

export const DiscoveryRunRequest = z.object({
  thesis: z.object({
    versionId: z.string().uuid(),
    criteria: ThesisCriteria,
  }).strict(),
  portfolios: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1),
    role: PortfolioRole.exclude(['not_suitable']),
    baseCurrency: z.string().trim().min(1),
    investmentObjective: z.string(),
  }).strict()).min(1),
  universe: z.array(SecurityUniverseRecord).min(1).max(500),
  maxCandidatesPerPortfolio: z.number().int().min(1).max(20).default(8),
  agentConfig: AgentCustomization.optional(),
}).strict().superRefine((request, context) => {
  if (request.agentConfig && request.agentConfig.agentKind !== 'market_research') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['agentConfig', 'agentKind'],
      message: 'Discovery runs accept only a market_research configuration',
    });
  }
});
export type DiscoveryRunRequest = z.infer<typeof DiscoveryRunRequest>;

export const DiscoveryCandidate = z.object({
  portfolioId: z.string().uuid(),
  ticker: z.string().trim().min(1),
  exchange: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  currency: z.string().trim().min(1),
  country: z.string().nullable(),
  sector: z.string().nullable(),
  thesisAlignmentScore: score,
  rationale: z.string().trim().min(1),
  matchedCriteria: z.array(z.string()),
  violatedCriteria: z.array(z.string()),
  groundedIn: z.array(z.string()).min(1),
  sourceUrls: z.array(z.string().url()).min(1),
  informationGaps: z.array(z.string()),
}).strict();
export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidate>;

export const MarketDiscoveryOutput = z.object({
  thesisVersion: z.number().int().positive(),
  marketMandates: z.array(z.object({
    portfolioId: z.string().uuid(),
    role: PortfolioRole.exclude(['not_suitable']),
    exchanges: z.array(z.string().min(1)).min(1),
    currency: z.string().min(1),
    rationale: z.string().min(1),
  }).strict()).min(1),
  candidates: z.array(DiscoveryCandidate),
  /** URLs copied by the service from actual web-search tool metadata, never model-authored. */
  verifiedWebSources: z.array(z.string().url()),
  limitations: z.array(z.string()),
}).strict();
export type MarketDiscoveryOutput = z.infer<typeof MarketDiscoveryOutput>;

export const DiscoveryRunStatus = z.object({
  externalDiscoveryId: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    currentStage: z.string(),
  }).strict().optional(),
  result: MarketDiscoveryOutput.optional(),
  errorMessage: z.string().min(1).optional(),
  updatedAt: z.string().datetime(),
}).strict();
export type DiscoveryRunStatus = z.infer<typeof DiscoveryRunStatus>;

export const AgenticRunSelection = z.object({
  thesisVersionId: z.string().uuid().optional(),
  portfolioIds: z.array(z.string().uuid()).min(1).optional(),
}).strict();
export type AgenticRunSelection = z.infer<typeof AgenticRunSelection>;

export const ExternalRunStatus = z.object({
  externalRunId: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    currentStage: z.string(),
  }).optional(),
  manifest: PortfolioAnalysisManifest.optional(),
  reportPdfUrl: z.string().url().optional(),
  errorMessage: z.string().min(1).optional(),
  updatedAt: z.string().datetime(),
}).strict();
export type ExternalRunStatus = z.infer<typeof ExternalRunStatus>;

export const FailedStage = z.enum([
  'extraction',
  'analysis',
  'synthesis',
  'render',
  'upload',
  'callback',
]);
export type FailedStage = z.infer<typeof FailedStage>;

export const AgenticImportRequest = z.discriminatedUnion('status', [
  z.object({
    externalRunId: z.string().min(1),
    status: z.literal('completed'),
    manifest: PortfolioAnalysisManifest,
    reportPdfUrl: z.string().url().optional(),
  }).strict(),
  z.object({
    externalRunId: z.string().min(1),
    status: z.literal('failed'),
    errorMessage: z.string().min(1),
    failedStage: FailedStage.optional(),
  }).strict(),
]);
export type AgenticImportRequest = z.infer<typeof AgenticImportRequest>;

export const MAX_THESIS_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_THESIS_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_THESIS_BASE64_CHARACTERS = Math.ceil(MAX_THESIS_PDF_BYTES / 3) * 4 + 4;

export const ThesisDocument = z.object({
  version: z.number().int().positive(),
  fileName: z.string().trim().min(1).max(255).refine(
    (value) => !/[\u0000-\u001f\u007f/\\]/.test(value),
    'Document filename contains forbidden characters'
  ),
  mimeType: z.enum(['application/pdf', 'text/plain', 'text/markdown']),
  contentBase64: z.string().min(1).max(MAX_THESIS_BASE64_CHARACTERS),
}).strict();
export type ThesisDocument = z.infer<typeof ThesisDocument>;

export const ThesisExtractionRequest = z.object({
  document: ThesisDocument,
  agentConfig: AgentCustomization.optional(),
}).strict().superRefine((request, context) => {
  if (request.agentConfig && request.agentConfig.agentKind !== 'thesis_extraction') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['agentConfig', 'agentKind'],
      message: 'Thesis extraction accepts only a thesis_extraction configuration',
    });
  }
});
export type ThesisExtractionRequest = z.infer<typeof ThesisExtractionRequest>;

export const ThesisExtractionStatus = z.object({
  externalExtractionId: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  result: ThesisExtractionResult.optional(),
  errorMessage: z.string().min(1).optional(),
  updatedAt: z.string().datetime(),
}).strict();
export type ThesisExtractionStatus = z.infer<typeof ThesisExtractionStatus>;

export class ContractValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractValidationError';
  }
}

export function validateInvestmentScoreGate(output: AnalysisOutput): void {
  if (output.thesisAlignmentScore < 45) {
    const ceiling = output.thesisAlignmentScore + 15;
    if (output.investmentScore > ceiling) {
      throw new ContractValidationError(
        `Thesis-alignment gate violated: investmentScore must be <= ${ceiling}`
      );
    }
  }
}

export function validateAnalysisSemantics(output: AnalysisOutput): void {
  validateInvestmentScoreGate(output);
  if (output.portfolioRole === 'not_suitable' && output.portfolioCandidate) {
    throw new ContractValidationError('not_suitable analyses cannot be portfolio candidates');
  }
  if (!/affirmative case\s*:/i.test(output.investmentThesis) ||
      !/strongest counter-case\s*:/i.test(output.investmentThesis)) {
    throw new ContractValidationError(
      'investmentThesis must label both "Affirmative case:" and "Strongest counter-case:"'
    );
  }
}

export function validateGrounding(output: AnalysisOutput, bundle: GroundingBundle): void {
  const available = new Set([
    ...Object.keys(bundle.computedMetrics),
    ...Object.keys(bundle.fundamentals),
  ]);
  if (available.size === 0) {
    throw new ContractValidationError(`No grounding was supplied for ${bundle.ticker}`);
  }
  const fabricated = output.groundedIn.filter((reference) => !available.has(reference));
  if (fabricated.length > 0) {
    throw new ContractValidationError(
      `Grounding validation failed for ${bundle.ticker}: ${fabricated.join(', ')}`
    );
  }
}

export function validateSynthesisCoverage(
  synthesis: ReportSynthesisOutput,
  analyses: AnalysisOutput[]
): void {
  const input = analyses.map((analysis) => analysis.ticker);
  const narratives = synthesis.perSecurityNarratives.map((item) => item.ticker);
  if (new Set(input).size !== input.length) {
    throw new ContractValidationError('Analysis tickers must be unique within a portfolio');
  }
  if (new Set(narratives).size !== narratives.length) {
    throw new ContractValidationError('Synthesis narratives must cover each ticker exactly once');
  }
  const inputSet = new Set(input);
  const missing = input.filter((ticker) => !narratives.includes(ticker));
  const extra = narratives.filter((ticker) => !inputSet.has(ticker));
  const fabricatedGrounding = synthesis.groundedIn.filter((ticker) => !inputSet.has(ticker));
  if (missing.length || extra.length || fabricatedGrounding.length) {
    throw new ContractValidationError(
      `Synthesis coverage invalid (missing=${missing.join(',')}; extra=${extra.join(',')}; grounding=${fabricatedGrounding.join(',')})`
    );
  }
}

export function validateRunRequestCoherence(request: AgenticRunRequest): void {
  const portfolioIds = request.portfolios.map((portfolio) => portfolio.id);
  if (new Set(portfolioIds).size !== portfolioIds.length) {
    throw new ContractValidationError('Portfolio IDs must be unique');
  }
  const allowedPortfolios = new Set(portfolioIds);
  const securityKeys = request.securities.map(
    (security) => `${security.portfolioId}:${security.exchange}:${security.ticker}`
  );
  const outputKeys = request.securities.map(
    (security) => `${security.portfolioId}:${security.ticker}`
  );
  if (new Set(securityKeys).size !== securityKeys.length || new Set(outputKeys).size !== outputKeys.length) {
    throw new ContractValidationError('Securities must be unique by portfolio and ticker');
  }
  if (request.securities.some((security) => !allowedPortfolios.has(security.portfolioId))) {
    throw new ContractValidationError('Every security must reference a supplied portfolio');
  }
  const groundingKeys = request.groundingBundles.map(
    ({ portfolioId, bundle }) => `${portfolioId}:${bundle.exchange}:${bundle.ticker}`
  );
  if (new Set(groundingKeys).size !== groundingKeys.length) {
    throw new ContractValidationError('Grounding bundles must be unique');
  }
  const requested = new Set(securityKeys);
  if (groundingKeys.length !== securityKeys.length || groundingKeys.some((key) => !requested.has(key))) {
    throw new ContractValidationError('Every requested security must have exactly one grounding bundle');
  }
}

export function universeGroundingKeys(record: SecurityUniverseRecord): string[] {
  return [
    'identity:ticker',
    'identity:exchange',
    'identity:companyName',
    'identity:currency',
    ...(record.country ? ['identity:country'] : []),
    ...(record.sector ? ['identity:sector'] : []),
    ...(record.industry ? ['identity:industry'] : []),
    ...Object.keys(record.attributes).map((key) => `attribute:${key}`),
  ];
}

export function validateDiscoveryOutput(
  output: MarketDiscoveryOutput,
  request: DiscoveryRunRequest
): void {
  if (output.thesisVersion !== request.thesis.criteria.version) {
    throw new ContractValidationError('Discovery output thesis version does not match the confirmed thesis');
  }

  const portfoliosById = new Map(request.portfolios.map((portfolio) => [portfolio.id, portfolio]));
  if (output.marketMandates.length !== portfoliosById.size) {
    throw new ContractValidationError('Discovery output must include one market mandate per portfolio');
  }
  const mandateIds = output.marketMandates.map((mandate) => mandate.portfolioId);
  if (new Set(mandateIds).size !== mandateIds.length || mandateIds.some((id) => !portfoliosById.has(id))) {
    throw new ContractValidationError('Discovery market mandates contain an unknown or duplicate portfolio');
  }
  const universeExchanges = new Set(request.universe.map((record) => record.exchange));
  const mandatesByPortfolio = new Map(output.marketMandates.map((mandate) => [mandate.portfolioId, mandate]));
  for (const mandate of output.marketMandates) {
    const portfolio = portfoliosById.get(mandate.portfolioId)!;
    if (mandate.role !== portfolio.role || mandate.currency !== portfolio.baseCurrency) {
      throw new ContractValidationError(`Discovery mandate changed portfolio identity for ${portfolio.id}`);
    }
    if (mandate.exchanges.some((exchange) => !universeExchanges.has(exchange))) {
      throw new ContractValidationError(`Discovery mandate introduced an exchange absent from the supplied universe`);
    }
  }

  const universe = new Map(request.universe.map((record) => [
    `${record.exchange}:${record.ticker}`,
    record,
  ]));
  const externallyRetrievedSources = new Set(output.verifiedWebSources);
  const seen = new Set<string>();
  const perPortfolio = new Map<string, number>();
  for (const candidate of output.candidates) {
    const portfolio = portfoliosById.get(candidate.portfolioId);
    if (!portfolio) throw new ContractValidationError(`Candidate references unknown portfolio ${candidate.portfolioId}`);
    const uniqueKey = `${candidate.portfolioId}:${candidate.exchange}:${candidate.ticker}`;
    if (seen.has(uniqueKey)) throw new ContractValidationError(`Duplicate discovery candidate ${uniqueKey}`);
    seen.add(uniqueKey);
    const count = (perPortfolio.get(candidate.portfolioId) ?? 0) + 1;
    perPortfolio.set(candidate.portfolioId, count);
    if (count > request.maxCandidatesPerPortfolio) {
      throw new ContractValidationError(`Too many candidates for portfolio ${candidate.portfolioId}`);
    }

    const record = universe.get(`${candidate.exchange}:${candidate.ticker}`);
    if (!record) throw new ContractValidationError(`Candidate ${candidate.ticker} is absent from the supplied universe`);
    if (
      candidate.companyName !== record.companyName ||
      candidate.currency !== record.currency ||
      candidate.country !== record.country ||
      candidate.sector !== record.sector
    ) {
      throw new ContractValidationError(`Candidate identity changed for ${candidate.ticker}`);
    }
    const mandate = mandatesByPortfolio.get(candidate.portfolioId)!;
    if (!mandate.exchanges.includes(candidate.exchange) || candidate.currency !== portfolio.baseCurrency) {
      throw new ContractValidationError(`Candidate ${candidate.ticker} does not match its portfolio market mandate`);
    }
    const availableGrounding = new Set(universeGroundingKeys(record));
    const fabricatedGrounding = candidate.groundedIn.filter((key) => !availableGrounding.has(key));
    if (fabricatedGrounding.length) {
      throw new ContractValidationError(
        `Discovery grounding failed for ${candidate.ticker}: ${fabricatedGrounding.join(', ')}`
      );
    }
    if (!candidate.sourceUrls.includes(record.sourceUrl)) {
      throw new ContractValidationError(`Candidate ${candidate.ticker} omitted its structured-universe source`);
    }
    if (candidate.sourceUrls.some((url) => url !== record.sourceUrl && !externallyRetrievedSources.has(url))) {
      throw new ContractValidationError(`Candidate ${candidate.ticker} cited a source absent from its universe record`);
    }
  }
}

export function validateManifestAgainstRequest(
  manifest: PortfolioAnalysisManifest,
  request: AgenticRunRequest
): void {
  if (manifest.thesisVersion !== request.thesis.criteria.version) {
    throw new ContractValidationError('Manifest thesis version does not match the run request');
  }
  const requestedPortfolios = new Map(request.portfolios.map((portfolio) => [portfolio.id, portfolio]));
  if (manifest.portfolios.length !== requestedPortfolios.size) {
    throw new ContractValidationError('Manifest must contain every requested portfolio exactly once');
  }
  const seenPortfolios = new Set<string>();
  for (const portfolio of manifest.portfolios) {
    const requestedPortfolio = requestedPortfolios.get(portfolio.portfolioId);
    if (!requestedPortfolio || seenPortfolios.has(portfolio.portfolioId)) {
      throw new ContractValidationError(`Unexpected or duplicate portfolio ${portfolio.portfolioId}`);
    }
    seenPortfolios.add(portfolio.portfolioId);
    if (portfolio.name !== requestedPortfolio.name || portfolio.baseCurrency !== requestedPortfolio.baseCurrency) {
      throw new ContractValidationError(`Portfolio metadata changed for ${portfolio.portfolioId}`);
    }
    const expected = request.securities
      .filter((security) => security.portfolioId === portfolio.portfolioId)
      .map((security) => security.ticker)
      .sort();
    const actual = portfolio.analyses.map((analysis) => analysis.ticker).sort();
    if (expected.length !== actual.length || expected.some((ticker, index) => ticker !== actual[index])) {
      throw new ContractValidationError(`Manifest security coverage changed for ${portfolio.portfolioId}`);
    }
    for (const output of portfolio.analyses) {
      validateAnalysisSemantics(output);
      const grounding = request.groundingBundles.find(
        (item) => item.portfolioId === portfolio.portfolioId && item.bundle.ticker === output.ticker
      );
      if (!grounding) throw new ContractValidationError(`Missing grounding for ${output.ticker}`);
      if (output.companyName !== grounding.bundle.companyName) {
        throw new ContractValidationError(`Company identity changed for ${output.ticker}`);
      }
      validateGrounding(output, grounding.bundle);
    }
    validateSynthesisCoverage(portfolio.synthesis, portfolio.analyses);
  }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableStringify(record[key])}`
  ).join(',')}}`;
}
