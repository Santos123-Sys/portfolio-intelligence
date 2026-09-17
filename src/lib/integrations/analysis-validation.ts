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
    'investmentThesis',
    'fundamentalSummary',
    'keyCatalysts',
    'keyRisks',
    'thesisBreakers',
    'informationGaps',
    'researchFramework',
  ];
  return watched
    .filter((field) => !sameValue(previous[field], next[field]))
    .map((field) => ({ field, from: previous[field], to: next[field] }));
}

/** JSON data in imported manifests is structurally immutable, but rehydrated
 * arrays and objects do not retain JavaScript reference identity. */
function sameValue(left: unknown, right: unknown) {
  if (left === right) return true;
  if (typeof left !== 'object' || left == null || typeof right !== 'object' || right == null) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}
