import { Currency, QuantError, RiskMetric, isoNow } from './types';

/**
 * Historical Expected Shortfall (CVaR): average loss in the worst tail beyond
 * the requested VaR confidence level. Returned as a positive fraction.
 */
export function expectedShortfall(
  returns: number[],
  ctx: { currency: Currency; dataAsOf: string },
  confidenceLevel = 0.95
): RiskMetric {
  if (returns.length < 2) throw new QuantError('expectedShortfall: need at least two returns');
  if (confidenceLevel <= 0 || confidenceLevel >= 1) {
    throw new QuantError('expectedShortfall: confidenceLevel must be in (0,1)');
  }

  const sortedLosses = [...returns].map((r) => -r).sort((a, b) => b - a);
  const tailSize = (1 - confidenceLevel) * sortedLosses.length;
  if (tailSize <= 0) throw new QuantError('expectedShortfall: empty tail');

  const full = Math.floor(tailSize);
  const fraction = tailSize - full;
  let total = sortedLosses.slice(0, full).reduce((a, b) => a + b, 0);
  if (fraction > 0 && full < sortedLosses.length) total += sortedLosses[full] * fraction;
  const value = Math.max(0, total / tailSize);

  return {
    metricName: `ES_${(confidenceLevel * 100).toFixed(0)}_1d`,
    value,
    currency: ctx.currency,
    methodology: `Historical average loss in the worst ${(1 - confidenceLevel) * 100}% tail of ${returns.length} periodic returns`,
    confidenceLevel,
    horizonDays: 1,
    lookbackDays: returns.length,
    annualizationFactor: null,
    computedAt: isoNow(),
    dataAsOf: ctx.dataAsOf,
    caveat: tailSize < 5
      ? `Only ${tailSize.toFixed(1)} observations contribute to the tail; Expected Shortfall is unstable at this sample size`
      : null,
  };
}
