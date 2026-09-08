import type { DiscoveryCandidate } from '@portfolio-intelligence/agentic-contract';
import type { DiscoveryLatestPrice } from './discovery-market-data';

export type DiscoveryEvidenceScorecard = {
  assessment: 'sufficient' | 'developing' | 'limited';
  verifiedSourceCount: number;
  groundedFactCount: number;
  informationGapCount: number;
  marketPriceStatus: 'available' | 'unavailable';
  summary: string;
};

/**
 * Transparent evidence coverage, deliberately not an opaque numerical score.
 * It tells the user what is present and absent before asking for a decision.
 */
export function scoreDiscoveryEvidence(
  candidate: Pick<DiscoveryCandidate, 'sourceUrls' | 'groundedIn' | 'informationGaps'>,
  latestPrice: DiscoveryLatestPrice | null
): DiscoveryEvidenceScorecard {
  const verifiedSourceCount = new Set(candidate.sourceUrls).size;
  const groundedFactCount = new Set(candidate.groundedIn).size;
  const informationGapCount = candidate.informationGaps.length;
  const assessment = verifiedSourceCount >= 2 && groundedFactCount >= 2 && informationGapCount <= 1
    ? 'sufficient'
    : verifiedSourceCount >= 1 && groundedFactCount >= 1
      ? 'developing'
      : 'limited';
  const summary = assessment === 'sufficient'
    ? 'Source coverage is adequate for a human review; confirm the remaining gap before relying on valuation.'
    : assessment === 'developing'
      ? 'Useful initial evidence is present, but the recorded gaps should shape the decision and next research step.'
      : 'Evidence is limited. Treat this as a research lead, not an investment-ready conclusion.';
  return {
    assessment,
    verifiedSourceCount,
    groundedFactCount,
    informationGapCount,
    marketPriceStatus: latestPrice ? 'available' : 'unavailable',
    summary,
  };
}
