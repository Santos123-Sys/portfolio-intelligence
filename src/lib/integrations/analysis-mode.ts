import {
  AgenticRunRequest,
  type AnalysisDataMode,
} from '@portfolio-intelligence/agentic-contract';

export const LIMITED_RESEARCH_RISK_MODE = 'limited_research_risk' as const;
export const LIMITED_DATA_DCF_LOCK_REASON =
  'DCF is locked for limited-data analysis because authoritative structured financial statements were not supplied.';

/**
 * Read the data mode from the immutable request saved with an external run.
 * Requests created before data modes were introduced retain their historical
 * full-fundamentals behavior.
 */
export function analysisModeFromRequest(
  requestJson: unknown,
  ticker: string,
  exchange: string
): AnalysisDataMode | null {
  const parsed = AgenticRunRequest.safeParse(requestJson);
  if (!parsed.success) return null;
  const match = parsed.data.groundingBundles.find(({ bundle }) =>
    bundle.ticker === ticker && bundle.exchange === exchange
  );
  if (!match) return null;
  return match.bundle.analysisMode ?? 'full_fundamentals';
}

export function isDcfLocked(mode: AnalysisDataMode | null): boolean {
  return mode === LIMITED_RESEARCH_RISK_MODE;
}
