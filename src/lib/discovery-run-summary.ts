import { DiscoveryRunRequest, MarketDiscoveryOutput } from '@portfolio-intelligence/agentic-contract';

export interface PortfolioCandidateCount {
  portfolioId: string;
  portfolioName: string;
  count: number;
  status: 'candidates_found' | 'no_candidates' | 'failed' | 'pending';
  reason: string;
}

/**
 * The configured limit applies to each portfolio independently. Keep the
 * combined total for operational reporting, but always return the portfolio
 * denominator beside it so a valid 6 + 6 result cannot look like a 12/6 cap
 * violation.
 */
export function summarizeDiscoveryCandidateCounts(
  requestJson: unknown,
  candidatePortfolioIds: string[],
  resultJson?: unknown,
  runError?: string | null
): {
  candidateCount: number;
  maxCandidatesPerPortfolio: number | null;
  portfolioCandidateCounts: PortfolioCandidateCount[];
} {
  const parsed = DiscoveryRunRequest.safeParse(requestJson);
  if (!parsed.success) {
    return {
      candidateCount: candidatePortfolioIds.length,
      maxCandidatesPerPortfolio: null,
      portfolioCandidateCounts: [],
    };
  }

  const counts = new Map<string, number>();
  for (const portfolioId of candidatePortfolioIds) {
    counts.set(portfolioId, (counts.get(portfolioId) ?? 0) + 1);
  }
  const result = MarketDiscoveryOutput.safeParse(resultJson);
  const outcomes = new Map(result.success ? (result.data.portfolioOutcomes ?? []).map((item) => [item.portfolioId, item] as const) : []);
  return {
    candidateCount: candidatePortfolioIds.length,
    maxCandidatesPerPortfolio: parsed.data.maxCandidatesPerPortfolio,
    portfolioCandidateCounts: parsed.data.portfolios.map((portfolio) => {
      const count = counts.get(portfolio.id) ?? 0;
      const outcome = outcomes.get(portfolio.id);
      const generatedCount = result.success ? result.data.candidates.filter((item) => item.portfolioId === portfolio.id).length : 0;
      return {
        portfolioId: portfolio.id,
        portfolioName: portfolio.name,
        count,
        status: outcome?.status ?? (runError ? 'failed' : result.success ? generatedCount ? 'candidates_found' : 'no_candidates' : 'pending'),
        reason: generatedCount > count
          ? `${generatedCount - count} previously rejected candidate(s) were omitted from this shortlist.`
          : outcome?.reason ?? runError ?? (result.success
            ? count ? `${count} candidates matched this portfolio.` : 'No candidates met this portfolio mandate in the supplied universe.'
            : 'Research has not completed for this portfolio.'),
      };
    }),
  };
}
