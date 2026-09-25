/** Select all DCF inputs from one dated, same-currency filing. */
export function selectFilingSnapshot<T extends {
  provider: string; metricName: string; observationDate: string | null;
  sourceUrl: string | null; currency: string | null; retrievedAt: Date;
}>(observations: T[], currency: string, metrics: readonly string[]): Map<string, T> {
  const eligible = observations.filter((row) => row.provider === 'investor-relations'
    && row.observationDate && row.sourceUrl
    && (row.currency === currency || row.metricName === 'shares_outstanding'));
  const selected = [...eligible].sort((left, right) =>
    right.observationDate!.localeCompare(left.observationDate!) || right.retrievedAt.getTime() - left.retrievedAt.getTime())[0];
  const result = new Map<string, T>();
  if (!selected) return result;
  for (const metric of metrics) {
    const matching = eligible.find((row) => row.metricName === metric
      && row.observationDate === selected.observationDate && row.sourceUrl === selected.sourceUrl);
    if (matching) result.set(metric, matching);
  }
  return result;
}
