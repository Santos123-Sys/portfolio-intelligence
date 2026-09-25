export interface FinancialObservation {
  metricName: string; valueNumeric: string | null; observationDate: string | null;
  currency: string | null; sourceUrl: string | null; sourceName: string | null;
  provider: string; status: string; retrievedAt: Date;
}
export interface AnnualFinancialRow {
  periodEnd: string; currency: string; sourceUrl: string; sourceName: string;
  metrics: Record<string, number>; revenueGrowth: number | null;
  operatingMargin: number | null; netMargin: number | null; cashConversion: number | null;
  gaps: string[];
}
export interface FinancialAnalysisReport {
  companyName: string; ticker: string; exchange: string; currency: string;
  periods: AnnualFinancialRow[]; generatedAt: string; status: 'data_available' | 'evidence_required';
  limitations: string[];
}
const REQUIRED = ['revenue', 'operating_income', 'net_income', 'operating_cash_flow', 'capital_expenditure'] as const;
const METRICS = new Set([...REQUIRED, 'free_cash_flow', 'total_debt', 'cash_and_equivalents', 'total_equity', 'shares_outstanding', 'gross_profit']);
const ratio = (numerator: number | undefined, denominator: number | undefined) =>
  numerator != null && denominator != null && denominator > 0 ? numerator / denominator : null;

/** One coherent filing per fiscal end; never mix sources to fill missing metrics. */
export function buildFinancialAnalysisReport(input: {
  companyName: string; ticker: string; exchange: string; currency: string;
  observations: FinancialObservation[]; now?: Date;
}): FinancialAnalysisReport {
  const groups = new Map<string, FinancialObservation[]>();
  for (const fact of input.observations) {
    if (fact.provider !== 'investor-relations' || fact.status !== 'OK' || !fact.observationDate || !fact.sourceUrl
      || !/^\d{4}-\d{2}-\d{2}$/.test(fact.observationDate) || !METRICS.has(fact.metricName)
      || fact.currency !== input.currency && fact.metricName !== 'shares_outstanding') continue;
    const key = `${fact.observationDate}|${fact.sourceUrl}|${fact.sourceName ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  const byPeriod = new Map<string, FinancialObservation[]>();
  for (const group of groups.values()) {
    const end = group[0].observationDate!;
    const previous = byPeriod.get(end);
    if (!previous || group[0].retrievedAt > previous[0].retrievedAt) byPeriod.set(end, group);
  }
  const periods: AnnualFinancialRow[] = [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-5).map(([periodEnd, group]) => {
    const metrics: Record<string, number> = {};
    const conflicts = new Set<string>();
    for (const fact of group.sort((a, b) => b.retrievedAt.getTime() - a.retrievedAt.getTime())) {
      const value = Number(fact.valueNumeric);
      if (!fact.valueNumeric || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) continue;
      if (metrics[fact.metricName] != null && metrics[fact.metricName] !== value) conflicts.add(fact.metricName);
      else metrics[fact.metricName] = value;
    }
    for (const metric of conflicts) delete metrics[metric];
    return { periodEnd, currency: input.currency, sourceUrl: group[0].sourceUrl!, sourceName: group[0].sourceName ?? 'Primary filing',
      metrics, revenueGrowth: null,
      operatingMargin: ratio(metrics.operating_income, metrics.revenue),
      netMargin: ratio(metrics.net_income, metrics.revenue),
      cashConversion: ratio(metrics.free_cash_flow, metrics.revenue),
      gaps: [...REQUIRED.filter((metric) => metrics[metric] == null), ...conflicts].filter((x, i, a) => a.indexOf(x) === i),
    };
  });
  periods.forEach((period, index) => {
    const prior = periods[index - 1];
    const currentRevenue = period.metrics.revenue;
    const priorRevenue = prior?.metrics.revenue;
    if (prior && Number(period.periodEnd.slice(0, 4)) - Number(prior.periodEnd.slice(0, 4)) === 1
      && currentRevenue != null && priorRevenue != null && priorRevenue > 0)
      period.revenueGrowth = currentRevenue / priorRevenue - 1;
  });
  const limitations = periods.length ? [] : ['No verified, same-currency annual financial facts have been imported for this company.'];
  if (periods.some((period) => period.gaps.length)) limitations.push('Missing or conflicting filing metrics are shown as gaps; no value has been estimated.');
  if (periods.length < 2) limitations.push('Year-over-year analysis requires at least two consecutive annual periods.');
  return { companyName: input.companyName, ticker: input.ticker, exchange: input.exchange, currency: input.currency,
    periods, generatedAt: (input.now ?? new Date()).toISOString(), status: periods.length ? 'data_available' : 'evidence_required', limitations };
}
