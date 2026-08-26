/**
 * Risk metrics. Every exported function returns a RiskMetric, never a bare number.
 *
 * That is deliberate. A Sharpe ratio of 1.4 is meaningless without knowing the
 * risk-free rate, the return frequency, the annualization factor, and the
 * lookback window. Returning a float invites the UI to render an authoritative-
 * looking number that nobody can audit. Returning the full object makes the
 * explainability drill-down the path of least resistance.
 *
 * METHODOLOGY CAUTION carried from the architecture: VaR and parametric measures
 * were designed for large, diversified, liquid institutional books. A concentrated
 * 10-30 position personal portfolio routinely violates the normality assumption
 * parametric VaR rests on, and a newly-opened position has no meaningful lookback.
 * These functions therefore emit a `caveat` when the sample is too thin, rather
 * than silently returning a confident-looking figure.
 */

import {
  Currency,
  QuantError,
  RiskMetric,
  TRADING_DAYS,
  VaRMethod,
  isoNow,
} from './types';

interface MetricContext {
  currency: Currency;
  dataAsOf: string;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) throw new QuantError('mean: empty series');
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n-1 denominator). */
export function stdDev(xs: number[]): number {
  if (xs.length < 2) throw new QuantError('stdDev: need at least two observations');
  const m = mean(xs);
  const ss = xs.reduce((acc, x) => acc + (x - m) ** 2, 0);
  return Math.sqrt(ss / (xs.length - 1));
}

/** Annualized volatility from periodic returns. */
export function volatility(
  returns: number[],
  ctx: MetricContext,
  periodsPerYear: number = TRADING_DAYS
): RiskMetric {
  const sd = stdDev(returns);
  return {
    metricName: 'Volatility',
    value: sd * Math.sqrt(periodsPerYear),
    currency: ctx.currency,
    methodology: `Sample standard deviation of ${returns.length} periodic returns, annualized by sqrt(${periodsPerYear})`,
    confidenceLevel: null,
    horizonDays: null,
    lookbackDays: returns.length,
    annualizationFactor: periodsPerYear,
    computedAt: isoNow(),
    dataAsOf: ctx.dataAsOf,
    caveat:
      returns.length < 30
        ? `Only ${returns.length} observations; annualized volatility is unstable below ~30`
        : null,
  };
}

/**
 * Annualized Sharpe ratio.
 *
 * `riskFreeAnnual` must be the rate for THIS portfolio's currency. A CHF
 * portfolio uses a CHF risk-free rate; using a USD rate against CHF returns
 * silently embeds an FX assumption (ADR-002 forbids this).
 */
export function sharpeRatio(
  returns: number[],
  riskFreeAnnual: number,
  ctx: MetricContext,
  periodsPerYear: number = TRADING_DAYS
): RiskMetric {
  const sd = stdDev(returns);
  if (sd === 0) throw new QuantError('sharpeRatio: zero volatility; ratio undefined');
  const rfPeriodic = Math.pow(1 + riskFreeAnnual, 1 / periodsPerYear) - 1;
  const excess = mean(returns) - rfPeriodic;
  const value = (excess / sd) * Math.sqrt(periodsPerYear);

  return {
    metricName: 'Sharpe',
    value,
    currency: ctx.currency,
    methodology:
      `(mean periodic excess return / sample stdev) * sqrt(${periodsPerYear}). ` +
      `Risk-free ${(riskFreeAnnual * 100).toFixed(2)}% annual in ${ctx.currency}, ` +
      `de-annualized geometrically to ${(rfPeriodic * 100).toFixed(5)}% per period`,
    confidenceLevel: null,
    horizonDays: null,
    lookbackDays: returns.length,
    annualizationFactor: periodsPerYear,
    computedAt: isoNow(),
    dataAsOf: ctx.dataAsOf,
    caveat:
      returns.length < 60
        ? `Only ${returns.length} observations; Sharpe has wide standard error on short samples`
        : null,
  };
}

/** Maximum peak-to-trough decline of a value series, as a positive fraction. */
export function maxDrawdown(values: number[], ctx: MetricContext): RiskMetric {
  if (values.length < 2) throw new QuantError('maxDrawdown: need at least two values');
  let peak = values[0];
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak !== 0) {
      const dd = (peak - v) / peak;
      if (dd > worst) worst = dd;
    }
  }
  return {
    metricName: 'MaxDrawdown',
    value: worst,
    currency: ctx.currency,
    methodology: `Largest peak-to-trough decline across ${values.length} valuations, expressed as a positive fraction of the peak`,
    confidenceLevel: null,
    horizonDays: null,
    lookbackDays: values.length,
    annualizationFactor: null,
    computedAt: isoNow(),
    dataAsOf: ctx.dataAsOf,
    caveat: null,
  };
}

/**
 * Inverse standard normal CDF (Acklam's rational approximation).
 * Accurate to roughly 1.15e-9 across the open interval, which is far beyond
 * what any VaR estimate on a personal portfolio warrants.
 */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) throw new QuantError('normInv: p must be in (0,1)');
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
             1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
             6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
             -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
             3.754408661907416e0];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
          ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

/**
 * Value at Risk, returned as a positive fraction of portfolio value.
 *
 * A result of 0.031 at 95%/1-day means: on 95% of days the loss is expected to
 * be no worse than 3.1% of value. It says nothing about how bad the other 5% get.
 *
 * `historical` makes no distributional assumption but cannot see a loss larger
 * than the worst one already in the sample. `parametric` extrapolates beyond the
 * sample but assumes normality, which equity returns violate in the tails —
 * precisely where VaR is supposed to be informative.
 */
export function valueAtRisk(
  returns: number[],
  ctx: MetricContext,
  opts: {
    method?: VaRMethod;
    confidenceLevel?: number;
    horizonDays?: number;
  } = {}
): RiskMetric {
  const { method = 'historical', confidenceLevel = 0.95, horizonDays = 1 } = opts;
  if (confidenceLevel <= 0 || confidenceLevel >= 1) {
    throw new QuantError('valueAtRisk: confidenceLevel must be in (0,1)');
  }
  if (returns.length < 2) throw new QuantError('valueAtRisk: need at least two returns');

  let daily: number;
  let methodology: string;
  let caveat: string | null = null;

  if (method === 'historical') {
    const sorted = [...returns].sort((a, b) => a - b);
    // Lower-tail quantile via linear interpolation between order statistics.
    const idx = (1 - confidenceLevel) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const q = lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
    daily = Math.max(0, -q);
    methodology =
      `Empirical ${((1 - confidenceLevel) * 100).toFixed(1)}th percentile of ` +
      `${returns.length} periodic returns, linearly interpolated between order statistics`;

    const tailCount = (1 - confidenceLevel) * returns.length;
    if (tailCount < 5) {
      caveat =
        `Only ~${tailCount.toFixed(1)} observations fall in the tail being estimated. ` +
        `Historical VaR at this confidence level is not meaningful on this sample size`;
    }
  } else if (method === 'parametric') {
    const m = mean(returns);
    const sd = stdDev(returns);
    const z = normInv(1 - confidenceLevel);
    daily = Math.max(0, -(m + z * sd));
    methodology =
      `Gaussian: -(mean + z * stdev) with z = ${z.toFixed(4)} at ` +
      `${(confidenceLevel * 100).toFixed(1)}% confidence, over ${returns.length} returns`;
    caveat =
      'Assumes normally distributed returns. Equity returns have fatter tails than ' +
      'the normal distribution, so this figure typically understates extreme loss';
  } else {
    throw new QuantError(`valueAtRisk: method '${method}' not implemented`);
  }

  // Square-root-of-time scaling. Valid only under i.i.d. returns; noted as such.
  const scaled = daily * Math.sqrt(horizonDays);
  if (horizonDays > 1) {
    const note = `Scaled from 1 day to ${horizonDays} days by sqrt(t), which assumes independent returns`;
    caveat = caveat ? `${caveat}. ${note}` : note;
  }

  return {
    metricName: `VaR_${(confidenceLevel * 100).toFixed(0)}_${horizonDays}d`,
    value: scaled,
    currency: ctx.currency,
    methodology,
    confidenceLevel,
    horizonDays,
    lookbackDays: returns.length,
    annualizationFactor: null,
    computedAt: isoNow(),
    dataAsOf: ctx.dataAsOf,
    caveat,
  };
}

/** Pearson correlation between two equal-length return series. */
export function correlation(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new QuantError('correlation: series length mismatch');
  if (a.length < 2) throw new QuantError('correlation: need at least two observations');
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) throw new QuantError('correlation: zero variance series');
  return num / Math.sqrt(da * db);
}
