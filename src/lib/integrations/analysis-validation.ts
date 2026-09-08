import { validateAnalysisSemantics, validateGrounding, type AnalysisOutput } from '@portfolio-intelligence/agentic-contract';

export { validateAnalysisSemantics, validateGrounding };

/** Produces an explicit dashboard delta between two immutable analyses. */
export function diffAnalyses(
  previous: AnalysisOutput,
  next: AnalysisOutput
): { field: string; from: unknown; to: unknown }[] {
  const watched: (keyof AnalysisOutput)[] = [
    'portfolioCandidate',
    'portfolioRole',
    'investmentScore',
    'thesisAlignmentScore',
    'qualityScore',
    'growthScore',
    'riskScore',
    'dividendScore',
    'confidenceScore',
    'researchFramework',
  ];
  return watched
    .filter((field) => previous[field] !== next[field])
    .map((field) => ({ field, from: previous[field], to: next[field] }));
}
