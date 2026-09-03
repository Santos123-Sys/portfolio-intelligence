import { DiscoveryRunRequest } from '@portfolio-intelligence/agentic-contract';

export interface PortfolioCandidateCount {
  portfolioId: string;
  portfolioName: string;
  count: number;
}

/**
 * The configured limit applies to each portfolio independently. Keep the
 * combined total for operational reporting, but always return the portfolio
 * denominator beside it so a valid 6 + 6 result cannot look like a 12/6 cap
 * violation.
 */
export function summarizeDiscoveryCandidateCounts(
  requestJson: unknown,
  candidatePortfolioIds: string[]
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
  return {
    candidateCount: candidatePortfolioIds.length,
    maxCandidatesPerPortfolio: parsed.data.maxCandidatesPerPortfolio,
    portfolioCandidateCounts: parsed.data.portfolios.map((portfolio) => ({
      portfolioId: portfolio.id,
      portfolioName: portfolio.name,
      count: counts.get(portfolio.id) ?? 0,
    })),
  };
}
