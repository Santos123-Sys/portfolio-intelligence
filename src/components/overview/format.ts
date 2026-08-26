/**
 * Shared formatting for the Overview page's headline metrics.
 *
 * Kept separate from the components so the server-rendered card and the
 * client-rendered drill-down agree on exactly how a value is displayed.
 */

export interface HeadlineMetric {
  metricName: string;
  value: number;
  currency: string;
  methodology: string;
  confidenceLevel: number | null;
  lookbackDays: number | null;
  horizonDays: number | null;
  annualizationFactor: number | null;
  caveat: string | null;
  computedAt: string;
  dataAsOf: string | null;
}

export const METRIC_LABELS: Record<string, string> = {
  Volatility: 'Volatility',
  Sharpe: 'Sharpe Ratio',
  MaxDrawdown: 'Max Drawdown',
};

/** Metrics reported as a share (0..1) rather than a raw ratio. */
const PERCENT_METRICS = new Set(['Volatility', 'MaxDrawdown', 'TWR']);

export function formatMetricValue(metric: HeadlineMetric): string {
  if (PERCENT_METRICS.has(metric.metricName)) {
    return `${(metric.value * 100).toFixed(2)}%`;
  }
  return metric.value.toFixed(2);
}

export const PORTFOLIO_TYPE_LABELS: Record<string, string> = {
  swiss_quality: 'Swiss Quality',
  brazilian_growth: 'Brazilian Growth',
  fixed_income: 'Fixed Income',
};
