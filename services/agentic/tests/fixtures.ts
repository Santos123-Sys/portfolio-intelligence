import type {
  AgenticRunRequest,
  AnalysisOutput,
  GroundingBundle,
  PortfolioAnalysisManifest,
  ReportSynthesisOutput,
  ThesisCriteria,
} from '@portfolio-intelligence/agentic-contract';

export const portfolioId = '550e8400-e29b-41d4-a716-446655440000';
export const thesisVersionId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

export const thesis: ThesisCriteria = {
  version: 1,
  portfolios: [{
    role: 'swiss_quality',
    currency: 'CHF',
    objective: 'Stable compounding',
    inclusionCriteria: ['Durable moat'],
    exclusionCriteria: ['Financial distress'],
    targetMetrics: { maxWeight: '15%' },
  }],
  globalConstraints: ['No leverage'],
};

export const grounding: GroundingBundle = {
  ticker: 'NESN',
  companyName: 'Nestle',
  exchange: 'XSWX',
  currency: 'CHF',
  sector: 'Consumer staples',
  country: 'CH',
  computedMetrics: {
    'position:weight:position-1': 0.12,
    'portfolioRiskMetric:Volatility:2026-08-26T00:00:00.000Z': 0.14,
  },
  dataAsOf: '2026-08-26T00:00:00.000Z',
  fundamentals: {
    'fundamental:free_cash_flow:observation-1': 12.3,
  },
};

export const analysis: AnalysisOutput = {
  ticker: 'NESN',
  companyName: 'Nestle',
  portfolioCandidate: true,
  portfolioRole: 'swiss_quality',
  investmentScore: 78,
  thesisAlignmentScore: 84,
  qualityScore: 88,
  growthScore: 55,
  riskScore: 30,
  dividendScore: 72,
  fundamentalSummary: 'The supplied free-cash-flow observation supports financial resilience.',
  investmentThesis: 'Affirmative case: Supplied evidence supports resilience. Strongest counter-case: Portfolio-level volatility and incomplete segment data limit confidence.',
  keyCatalysts: ['Continued free-cash-flow resilience'],
  keyRisks: ['Portfolio-level volatility context remains material'],
  thesisBreakers: ['Loss of the supplied free-cash-flow resilience'],
  confidenceScore: 0.72,
  groundedIn: [
    'fundamental:free_cash_flow:observation-1',
    'portfolioRiskMetric:Volatility:2026-08-26T00:00:00.000Z',
  ],
  informationGaps: ['No segment-level revenue observation was supplied'],
};

export const synthesis: ReportSynthesisOutput = {
  executiveSummary: 'The sole supplied holding is a candidate, subject to the recorded evidence gaps.',
  thematicHighlights: ['Resilience is the central supplied theme.'],
  concentrationFlags: ['The supplied position weight is 0.12.'],
  perSecurityNarratives: [{ ticker: 'NESN', narrative: 'NESN remains a candidate with explicitly limited confidence.' }],
  watchlistAndViolations: ['NESN: Monitor the stated thesis-breaker condition.'],
  disclaimer: 'This analytical tool output is not professional financial advice and depends on supplied dashboard data.',
  groundedIn: ['NESN'],
};

export const runRequest: AgenticRunRequest = {
  thesis: { versionId: thesisVersionId, criteria: thesis },
  securities: [{ ticker: 'NESN', exchange: 'XSWX', portfolioId }],
  portfolios: [{
    id: portfolioId,
    name: 'Swiss Quality',
    baseCurrency: 'CHF',
    investmentObjective: 'Stable compounding',
  }],
  groundingBundles: [{ portfolioId, bundle: grounding }],
};

export const manifest: PortfolioAnalysisManifest = {
  schemaVersion: '1.0',
  generatedAt: '2026-08-26T12:00:00.000Z',
  thesisVersion: 1,
  portfolios: [{
    portfolioId,
    name: 'Swiss Quality',
    baseCurrency: 'CHF',
    analyses: [analysis],
    synthesis,
  }],
};
