import {
  AnalysisValidationError,
  type AnalysisOutput,
  type GroundingBundle,
} from './analysis-contract';

/** Rejects references to metrics or fundamentals absent from the supplied bundle. */
export function validateGrounding(output: AnalysisOutput, bundle: GroundingBundle): void {
  const available = new Set([
    ...Object.keys(bundle.computedMetrics),
    ...Object.keys(bundle.fundamentals),
  ]);
  if (available.size === 0) return;

  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedAvailable = [...available].map(normalize);
  const fabricated = output.groundedIn.filter((reference) => {
    const normalized = normalize(reference);
    return !normalizedAvailable.some((candidate) =>
      normalized.includes(candidate) || candidate.includes(normalized)
    );
  });

  if (fabricated.length > 0) {
    throw new AnalysisValidationError(
      `Grounding validation failed. The analysis cites data it was not given: ` +
      `${fabricated.join(', ')}. Available: ${[...available].join(', ')}`
    );
  }
}

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
  ];
  return watched
    .filter((field) => previous[field] !== next[field])
    .map((field) => ({ field, from: previous[field], to: next[field] }));
}
