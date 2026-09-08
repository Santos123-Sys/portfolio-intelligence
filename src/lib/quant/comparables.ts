import { QuantError } from './types';

export interface ComparablePeerInput {
  companyName: string;
  ticker: string;
  marketCapitalization: number;
  netDebt: number;
  minorityInterest?: number;
  preferredStock?: number;
  revenue?: number;
  ebitda?: number;
  netIncome?: number;
  sourceUrl: string;
}

export interface ComparableTargetInput {
  companyName: string;
  currency: string;
  revenue?: number;
  ebitda?: number;
  netIncome?: number;
  netDebt?: number;
  sharesOutstanding?: number;
}

export interface MultipleStatistics {
  count: number;
  mean: number | null;
  median: number | null;
  percentile25: number | null;
  percentile75: number | null;
}

export interface ComparableResult {
  method: 'comparable_companies';
  currency: string;
  target: ComparableTargetInput;
  peers: Array<ComparablePeerInput & {
    enterpriseValue: number;
    evRevenue: number | null;
    evEbitda: number | null;
    pe: number | null;
    outlierMultiples: string[];
  }>;
  statistics: Record<'evRevenue' | 'evEbitda' | 'pe', MultipleStatistics>;
  impliedValuations: Array<{
    multiple: 'EV / Revenue' | 'EV / EBITDA' | 'P / E';
    statistic: 'Median' | 'Mean';
    multipleValue: number;
    impliedEnterpriseValue: number | null;
    impliedEquityValue: number | null;
    impliedValuePerShare: number | null;
  }>;
  methodology: string;
  caveats: string[];
  computedAt: string;
}

function finite(name: string, value: number | undefined): number | undefined {
  if (value == null) return undefined;
  if (!Number.isFinite(value)) throw new QuantError(`Comparable-company ${name} must be finite`);
  return value;
}

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high ? ordered[low] : ordered[low] + (ordered[high] - ordered[low]) * (position - low);
}

function statistics(values: Array<number | null>): MultipleStatistics {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  return {
    count: valid.length,
    mean: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null,
    median: quantile(valid, 0.5),
    percentile25: quantile(valid, 0.25),
    percentile75: quantile(valid, 0.75),
  };
}

function outlier(value: number | null, stats: MultipleStatistics): boolean {
  if (value == null || stats.percentile25 == null || stats.percentile75 == null) return false;
  const iqr = stats.percentile75 - stats.percentile25;
  if (iqr === 0) return false;
  return value < stats.percentile25 - 1.5 * iqr || value > stats.percentile75 + 1.5 * iqr;
}

function multiple(value: number, denominator: number | undefined): number | null {
  return denominator != null && denominator > 0 ? value / denominator : null;
}

function impliedValue(
  target: ComparableTargetInput,
  multipleName: 'EV / Revenue' | 'EV / EBITDA' | 'P / E',
  statistic: 'Median' | 'Mean',
  multipleValue: number
) {
  const base = multipleName === 'EV / Revenue' ? target.revenue
    : multipleName === 'EV / EBITDA' ? target.ebitda
      : target.netIncome;
  if (base == null || base <= 0) return null;
  const equityValue = multipleName === 'P / E'
    ? multipleValue * base
    : multipleValue * base - (target.netDebt ?? 0);
  return {
    multiple: multipleName,
    statistic,
    multipleValue,
    impliedEnterpriseValue: multipleName === 'P / E' ? null : multipleValue * base,
    impliedEquityValue: equityValue,
    impliedValuePerShare: target.sharesOutstanding && target.sharesOutstanding > 0 ? equityValue / target.sharesOutstanding : null,
  };
}

export function comparableCompanyAnalysis(
  target: ComparableTargetInput,
  peers: ComparablePeerInput[]
): ComparableResult {
  if (!/^[A-Z]{3}$/.test(target.currency)) throw new QuantError('Comparable-company currency must be an ISO 4217 code');
  if (peers.length < 6 || peers.length > 10) throw new QuantError('Comparable-company analysis requires 6 to 10 peers');
  const tickers = new Set<string>();
  const normalizedPeers = peers.map((peer) => {
    if (!peer.companyName.trim() || !peer.ticker.trim() || !peer.sourceUrl.trim()) {
      throw new QuantError('Each peer requires company name, ticker, and source URL');
    }
    if (tickers.has(peer.ticker.toUpperCase())) throw new QuantError(`Duplicate peer ticker: ${peer.ticker}`);
    tickers.add(peer.ticker.toUpperCase());
    const marketCapitalization = finite('market capitalization', peer.marketCapitalization)!;
    const netDebt = finite('net debt', peer.netDebt)!;
    const minorityInterest = finite('minority interest', peer.minorityInterest) ?? 0;
    const preferredStock = finite('preferred stock', peer.preferredStock) ?? 0;
    if (marketCapitalization <= 0) throw new QuantError('Comparable-company market capitalization must be positive');
    const enterpriseValue = marketCapitalization + netDebt + minorityInterest + preferredStock;
    return {
      ...peer,
      marketCapitalization,
      netDebt,
      minorityInterest,
      preferredStock,
      revenue: finite('revenue', peer.revenue),
      ebitda: finite('EBITDA', peer.ebitda),
      netIncome: finite('net income', peer.netIncome),
      enterpriseValue,
      evRevenue: multiple(enterpriseValue, peer.revenue),
      evEbitda: multiple(enterpriseValue, peer.ebitda),
      pe: multiple(marketCapitalization, peer.netIncome),
      outlierMultiples: [] as string[],
    };
  });
  const statisticsByMultiple = {
    evRevenue: statistics(normalizedPeers.map((peer) => peer.evRevenue)),
    evEbitda: statistics(normalizedPeers.map((peer) => peer.evEbitda)),
    pe: statistics(normalizedPeers.map((peer) => peer.pe)),
  };
  for (const peer of normalizedPeers) {
    if (outlier(peer.evRevenue, statisticsByMultiple.evRevenue)) peer.outlierMultiples.push('EV / Revenue');
    if (outlier(peer.evEbitda, statisticsByMultiple.evEbitda)) peer.outlierMultiples.push('EV / EBITDA');
    if (outlier(peer.pe, statisticsByMultiple.pe)) peer.outlierMultiples.push('P / E');
  }
  const valuationInputs: Array<['EV / Revenue' | 'EV / EBITDA' | 'P / E', MultipleStatistics]> = [
    ['EV / Revenue', statisticsByMultiple.evRevenue],
    ['EV / EBITDA', statisticsByMultiple.evEbitda],
    ['P / E', statisticsByMultiple.pe],
  ];
  const impliedValuations = valuationInputs.flatMap(([name, values]) => [
    values.median == null ? null : impliedValue(target, name, 'Median', values.median),
    values.mean == null ? null : impliedValue(target, name, 'Mean', values.mean),
  ]).filter((value): value is NonNullable<typeof value> => value != null);
  if (!impliedValuations.length) throw new QuantError('No target metric is available for peer-multiple application');
  return {
    method: 'comparable_companies',
    currency: target.currency,
    target,
    peers: normalizedPeers,
    statistics: statisticsByMultiple,
    impliedValuations,
    methodology: 'Comparable-company analysis: enterprise value equals market capitalization plus net debt, minority interest, and preferred stock. Multiples and summary statistics are calculated deterministically from the human-reviewed peer inputs.',
    caveats: [
      'Peer selection and source quality remain a human judgment; this calculator does not certify comparability.',
      'Outlier flags use the 1.5x interquartile-range rule and are a review prompt, not an automatic exclusion.',
      'Implied values are scenario outputs, not market-price predictions or trade instructions.',
    ],
    computedAt: new Date().toISOString(),
  };
}
