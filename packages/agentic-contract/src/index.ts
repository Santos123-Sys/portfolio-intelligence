import { z } from 'zod';

export const MANIFEST_SCHEMA_VERSION = '1.0' as const;

export const PortfolioRole = z.enum([
  'swiss_quality',
  'brazilian_growth',
  'fixed_income',
  'not_suitable',
]);
export type PortfolioRole = z.infer<typeof PortfolioRole>;

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
}).strict();
export type AgenticRunRequest = z.infer<typeof AgenticRunRequest>;

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

export const ThesisExtractionRequest = z.object({ document: ThesisDocument }).strict();
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
