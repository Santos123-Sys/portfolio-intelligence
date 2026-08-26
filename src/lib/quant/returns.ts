/**
 * Return calculations: simple, time-weighted (TWR), money-weighted (MWR/XIRR).
 *
 * TWR and MWR answer different questions and routinely disagree:
 *   - TWR strips out the effect of deposits and withdrawals. It measures the
 *     performance of the *strategy*, and is what you compare against a benchmark.
 *   - MWR is the internal rate of return on actual cash. It measures the
 *     performance of *your money*, and is affected by when you added capital.
 *
 * A portfolio that returned 10% while you happened to add a large deposit right
 * before a drawdown will show a healthy TWR and a poor MWR. Both are correct.
 * The dashboard must therefore label which one it is showing, never just "return".
 */

import { CashFlow, QuantError, ValuationPoint } from './types';

/** Simple holding-period return between two values. */
export function simpleReturn(startValue: number, endValue: number): number {
  if (startValue === 0) {
    throw new QuantError('simpleReturn: startValue is zero; return is undefined');
  }
  return (endValue - startValue) / startValue;
}

/** Convert a series of valuations into period-over-period simple returns. */
export function toReturnSeries(points: ValuationPoint[]): number[] {
  if (points.length < 2) return [];
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value;
    if (prev === 0) {
      throw new QuantError(`toReturnSeries: zero valuation at ${sorted[i - 1].date}`);
    }
    out.push((sorted[i].value - prev) / prev);
  }
  return out;
}

/**
 * True time-weighted return via sub-period geometric linking.
 *
 * The portfolio is broken into sub-periods at every external cash flow. Each
 * sub-period's return is computed on the value immediately before the flow, and
 * the sub-period returns are chained. This removes the timing and size of
 * deposits from the result entirely.
 *
 * Convention: a cash flow dated D is treated as occurring at the *end* of D,
 * so the valuation on D still reflects pre-flow value.
 */
export function timeWeightedReturn(
  valuations: ValuationPoint[],
  cashFlows: CashFlow[] = []
): number {
  if (valuations.length < 2) {
    throw new QuantError('timeWeightedReturn: need at least two valuations');
  }
  const vals = [...valuations].sort((a, b) => a.date.localeCompare(b.date));
  const flowByDate = new Map<string, number>();
  for (const cf of cashFlows) {
    flowByDate.set(cf.date, (flowByDate.get(cf.date) ?? 0) + cf.amount);
  }

  let linked = 1;
  for (let i = 1; i < vals.length; i++) {
    const prevVal = vals[i - 1].value;
    // Flow occurring at the end of the previous date enters this sub-period's base.
    const flow = flowByDate.get(vals[i - 1].date) ?? 0;
    const base = prevVal + flow;
    if (base === 0) {
      throw new QuantError(
        `timeWeightedReturn: sub-period base is zero at ${vals[i - 1].date}`
      );
    }
    linked *= vals[i].value / base;
  }
  return linked - 1;
}

/** Annualize a cumulative return over a given number of calendar days. */
export function annualizeReturn(cumulativeReturn: number, days: number): number {
  if (days <= 0) throw new QuantError('annualizeReturn: days must be positive');
  return Math.pow(1 + cumulativeReturn, 365 / days) - 1;
}

function yearsBetween(a: string, b: string): number {
  const ms = Date.parse(b) - Date.parse(a);
  return ms / (365 * 24 * 60 * 60 * 1000);
}

/** Net present value of dated cash flows at annual rate `rate`. */
export function xnpv(rate: number, flows: CashFlow[]): number {
  if (flows.length === 0) throw new QuantError('xnpv: no cash flows');
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const t0 = sorted[0].date;
  return sorted.reduce((acc, f) => {
    const t = yearsBetween(t0, f.date);
    return acc + f.amount / Math.pow(1 + rate, t);
  }, 0);
}

/**
 * Money-weighted return (XIRR) — the annual rate at which NPV of all flows is zero.
 *
 * Solved by bisection rather than Newton-Raphson. Newton converges faster but can
 * diverge on irregular flow patterns, which is exactly what a real portfolio
 * produces. Bisection is slower and cannot fail to converge inside the bracket,
 * which is the right trade for a number a human will act on.
 *
 * Convention: contributions are negative (cash leaving you, entering the
 * portfolio), withdrawals and the terminal value are positive.
 */
export function moneyWeightedReturn(
  flows: CashFlow[],
  opts: { lo?: number; hi?: number; tol?: number; maxIter?: number } = {}
): number {
  const { lo = -0.9999, hi = 100, tol = 1e-7, maxIter = 500 } = opts;
  if (flows.length < 2) throw new QuantError('moneyWeightedReturn: need >= 2 flows');

  const hasPos = flows.some((f) => f.amount > 0);
  const hasNeg = flows.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) {
    throw new QuantError(
      'moneyWeightedReturn: flows must contain both positive and negative amounts'
    );
  }

  let a = lo;
  let b = hi;
  let fa = xnpv(a, flows);
  let fb = xnpv(b, flows);
  if (fa * fb > 0) {
    throw new QuantError(
      'moneyWeightedReturn: no sign change in bracket; IRR may not exist or is outside [-99.99%, 10000%]'
    );
  }

  for (let i = 0; i < maxIter; i++) {
    const mid = (a + b) / 2;
    const fmid = xnpv(mid, flows);
    if (Math.abs(fmid) < tol || (b - a) / 2 < tol) return mid;
    if (fa * fmid < 0) {
      b = mid;
      fb = fmid;
    } else {
      a = mid;
      fa = fmid;
    }
  }
  return (a + b) / 2;
}
