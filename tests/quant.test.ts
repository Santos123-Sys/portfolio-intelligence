/**
 * Quant engine verification.
 *
 * Every assertion here is against a value that can be checked by hand or in a
 * spreadsheet. That is the point: this file is the "checked against a known-correct
 * source" gate from Phase 1 step 2. If these pass, the calculation layer can be
 * trusted enough to build on.
 */

import { describe, it, expect } from 'vitest';
import {
  simpleReturn,
  toReturnSeries,
  timeWeightedReturn,
  moneyWeightedReturn,
  annualizeReturn,
  xnpv,
} from '../src/lib/quant/returns';
import {
  mean,
  stdDev,
  volatility,
  sharpeRatio,
  maxDrawdown,
  valueAtRisk,
  correlation,
  normInv,
} from '../src/lib/quant/risk';
import {
  positionWeights,
  sectorWeights,
  concentrationHHI,
  assertSingleCurrency,
  WeightableHolding,
} from '../src/lib/quant/weights';
import { Currency } from '../src/lib/quant/types';

const ctx = { currency: 'CHF' as Currency, dataAsOf: '2026-08-25T00:00:00Z' };

describe('simple returns', () => {
  it('computes a plain holding-period return', () => {
    expect(simpleReturn(100, 110)).toBeCloseTo(0.1, 12);
    expect(simpleReturn(200, 150)).toBeCloseTo(-0.25, 12);
  });

  it('throws rather than returning Infinity on a zero base', () => {
    expect(() => simpleReturn(0, 50)).toThrow(/startValue is zero/);
  });

  it('builds a return series from valuations', () => {
    const s = toReturnSeries([
      { date: '2026-01-01', value: 100 },
      { date: '2026-01-02', value: 110 },
      { date: '2026-01-03', value: 99 },
    ]);
    expect(s).toHaveLength(2);
    expect(s[0]).toBeCloseTo(0.1, 12);
    expect(s[1]).toBeCloseTo(-0.1, 12);
  });

  it('sorts by date before differencing', () => {
    const s = toReturnSeries([
      { date: '2026-01-03', value: 99 },
      { date: '2026-01-01', value: 100 },
      { date: '2026-01-02', value: 110 },
    ]);
    expect(s[0]).toBeCloseTo(0.1, 12);
  });
});

describe('time-weighted return', () => {
  it('equals the simple return when there are no cash flows', () => {
    const twr = timeWeightedReturn([
      { date: '2026-01-01', value: 100 },
      { date: '2026-06-30', value: 120 },
    ]);
    expect(twr).toBeCloseTo(0.2, 12);
  });

  it('strips out a mid-period deposit', () => {
    // 100 -> 110 (+10%), then 50 deposited, 160 -> 176 (+10%).
    // Strategy returned 10% twice; TWR must be 1.1*1.1-1 = 21%.
    const twr = timeWeightedReturn(
      [
        { date: '2026-01-01', value: 100 },
        { date: '2026-02-01', value: 110 },
        { date: '2026-03-01', value: 176 },
      ],
      [{ date: '2026-02-01', amount: 50 }]
    );
    expect(twr).toBeCloseTo(0.21, 10);
  });

  it('is unaffected by deposit size — the whole point of TWR', () => {
    const small = timeWeightedReturn(
      [
        { date: '2026-01-01', value: 100 },
        { date: '2026-02-01', value: 110 },
        { date: '2026-03-01', value: 121 },
      ],
      [{ date: '2026-02-01', amount: 0 }]
    );
    const large = timeWeightedReturn(
      [
        { date: '2026-01-01', value: 100 },
        { date: '2026-02-01', value: 110 },
        { date: '2026-03-01', value: 1210 },
      ],
      [{ date: '2026-02-01', amount: 990 }]
    );
    expect(small).toBeCloseTo(large, 10);
    expect(small).toBeCloseTo(0.21, 10);
  });

  it('annualizes correctly', () => {
    // 21% over 365 days is 21%.
    expect(annualizeReturn(0.21, 365)).toBeCloseTo(0.21, 10);
    // 10% over half a year annualizes to 1.1^2 - 1 = 21%.
    expect(annualizeReturn(0.1, 182.5)).toBeCloseTo(0.21, 6);
  });
});

describe('money-weighted return (XIRR)', () => {
  it('recovers a known 10% annual rate', () => {
    const irr = moneyWeightedReturn([
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1100 },
    ]);
    expect(irr).toBeCloseTo(0.1, 4);
  });

  it('handles multiple contributions', () => {
    const flows = [
      { date: '2025-01-01', amount: -1000 },
      { date: '2025-07-01', amount: -500 },
      { date: '2026-01-01', amount: 1650 },
    ];
    const irr = moneyWeightedReturn(flows);
    // Verify by substitution: NPV at the solved rate must be ~zero.
    expect(Math.abs(xnpv(irr, flows))).toBeLessThan(1e-4);
  });

  it('diverges from TWR when contribution timing matters', () => {
    // Large deposit immediately before a decline: TWR healthy, MWR poor.
    const twr = timeWeightedReturn(
      [
        { date: '2025-01-01', value: 100 },
        { date: '2025-11-01', value: 150 },
        { date: '2026-01-01', value: 1147.5 },
      ],
      [{ date: '2025-11-01', amount: 1200 }]
    );
    const mwr = moneyWeightedReturn([
      { date: '2025-01-01', amount: -100 },
      { date: '2025-11-01', amount: -1200 },
      { date: '2026-01-01', amount: 1147.5 },
    ]);
    expect(twr).toBeGreaterThan(0);
    expect(mwr).toBeLessThan(0);
  });

  it('refuses flows with no sign change', () => {
    expect(() =>
      moneyWeightedReturn([
        { date: '2025-01-01', amount: -100 },
        { date: '2026-01-01', amount: -100 },
      ])
    ).toThrow(/both positive and negative/);
  });
});

describe('descriptive statistics', () => {
  it('computes mean and sample stdev against hand-checked values', () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(xs)).toBeCloseTo(5, 12);
    // Population sd is 2; sample sd = sqrt(32/7).
    expect(stdDev(xs)).toBeCloseTo(Math.sqrt(32 / 7), 12);
  });

  it('computes correlation of +1 and -1 exactly', () => {
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(correlation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
  });
});

describe('volatility and Sharpe', () => {
  const returns = Array.from({ length: 252 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.005));

  it('annualizes volatility by sqrt(252)', () => {
    const v = volatility(returns, ctx);
    expect(v.value).toBeCloseTo(stdDev(returns) * Math.sqrt(252), 10);
    expect(v.annualizationFactor).toBe(252);
    expect(v.currency).toBe('CHF');
  });

  it('flags a thin sample rather than staying silent', () => {
    const v = volatility([0.01, -0.01, 0.02], ctx);
    expect(v.caveat).toMatch(/observations/);
  });

  it('produces zero Sharpe when excess return is zero', () => {
    const flat = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
    const rfPeriodic = mean(flat);
    const rfAnnual = Math.pow(1 + rfPeriodic, 252) - 1;
    const s = sharpeRatio(flat, rfAnnual, ctx);
    expect(s.value).toBeCloseTo(0, 8);
  });

  it('records the risk-free rate in its own methodology string', () => {
    const s = sharpeRatio(returns, 0.02, ctx);
    expect(s.methodology).toContain('2.00%');
    expect(s.methodology).toContain('CHF');
  });

  it('refuses to compute Sharpe on a zero-volatility series', () => {
    expect(() => sharpeRatio([0.01, 0.01, 0.01], 0.0, ctx)).toThrow(/zero volatility/);
  });
});

describe('drawdown', () => {
  it('finds the largest peak-to-trough decline', () => {
    // Peak 120, trough 60 -> 50%.
    const dd = maxDrawdown([100, 120, 90, 60, 80, 110], ctx);
    expect(dd.value).toBeCloseTo(0.5, 12);
  });

  it('returns zero for a monotonically rising series', () => {
    expect(maxDrawdown([100, 101, 102, 103], ctx).value).toBeCloseTo(0, 12);
  });
});

describe('value at risk', () => {
  // Deterministic symmetric sample, easy to reason about by hand.
  const sample = Array.from({ length: 1000 }, (_, i) => (i - 500) / 10000);

  it('computes a historical lower-tail quantile', () => {
    const v = valueAtRisk(sample, ctx, { method: 'historical', confidenceLevel: 0.95 });
    // 5th percentile of a linear spread from -0.05 to +0.0499
    expect(v.value).toBeGreaterThan(0.044);
    expect(v.value).toBeLessThan(0.046);
    expect(v.confidenceLevel).toBe(0.95);
    expect(v.horizonDays).toBe(1);
  });

  it('always warns that parametric VaR assumes normality', () => {
    const v = valueAtRisk(sample, ctx, { method: 'parametric' });
    expect(v.caveat).toMatch(/fatter tails|normally distributed/);
  });

  it('warns when the tail sample is too thin to mean anything', () => {
    const thin = [0.01, -0.02, 0.03, -0.01, 0.005, -0.015, 0.02, -0.005];
    const v = valueAtRisk(thin, ctx, { confidenceLevel: 0.99 });
    expect(v.caveat).toMatch(/not meaningful/);
  });

  it('discloses sqrt-time scaling in the caveat', () => {
    const v = valueAtRisk(sample, ctx, { horizonDays: 10 });
    expect(v.caveat).toMatch(/sqrt\(t\)|independent returns/);
  });

  it('scales by sqrt of horizon', () => {
    const one = valueAtRisk(sample, ctx, { horizonDays: 1 }).value;
    const ten = valueAtRisk(sample, ctx, { horizonDays: 10 }).value;
    expect(ten).toBeCloseTo(one * Math.sqrt(10), 10);
  });

  it('inverts the normal CDF at known points', () => {
    expect(normInv(0.5)).toBeCloseTo(0, 8);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normInv(0.05)).toBeCloseTo(-1.644854, 5);
  });
});

describe('weights and the ADR-002 currency guard', () => {
  const chf: WeightableHolding[] = [
    { id: '1', ticker: 'NESN', companyName: 'Nestle', currency: 'CHF', marketValueNative: 50000, sector: 'Staples', country: 'CH', portfolioId: 'p1' },
    { id: '2', ticker: 'ROG', companyName: 'Roche', currency: 'CHF', marketValueNative: 30000, sector: 'Health', country: 'CH', portfolioId: 'p1' },
    { id: '3', ticker: 'NOVN', companyName: 'Novartis', currency: 'CHF', marketValueNative: 20000, sector: 'Health', country: 'CH', portfolioId: 'p1' },
  ];

  it('computes position weights summing to 1', () => {
    const w = positionWeights(chf);
    expect(w[0].weight).toBeCloseTo(0.5, 12);
    expect(w.reduce((a, r) => a + r.weight, 0)).toBeCloseTo(1, 12);
  });

  it('returns positions sorted largest first', () => {
    expect(positionWeights(chf).map((r) => r.key)).toEqual(['1', '2', '3']);
  });

  it('aggregates sector weights', () => {
    const s = sectorWeights(chf);
    expect(s.find((r) => r.key === 'Health')!.weight).toBeCloseTo(0.5, 12);
  });

  it('REFUSES to weight across currencies', () => {
    const mixed = [
      ...chf,
      { id: '4', ticker: 'PETR4', companyName: 'Petrobras', currency: 'BRL' as Currency, marketValueNative: 100000, sector: 'Energy', country: 'BR', portfolioId: 'p2' },
    ];
    expect(() => positionWeights(mixed)).toThrow(/ADR-002/);
    expect(() => assertSingleCurrency(mixed)).toThrow(/mixed currencies/);
  });

  it('computes effective position count below the raw count when concentrated', () => {
    const c = concentrationHHI(chf);
    expect(c.largestWeight).toBeCloseTo(0.5, 12);
    expect(c.hhi).toBeCloseTo(0.25 + 0.09 + 0.04, 12);
    expect(c.effectivePositions).toBeLessThan(3);
  });
});
