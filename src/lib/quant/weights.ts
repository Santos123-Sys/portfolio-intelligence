/**
 * Position and exposure weights.
 *
 * ADR-002 is enforced here as a runtime guard, not a convention. `assertSingleCurrency`
 * throws if asked to weight positions denominated in different currencies, because
 * a "weight" derived from adding CHF to BRL is not a wrong number — it is a
 * meaningless one, and meaningless numbers that look plausible are the failure
 * mode this whole architecture exists to prevent.
 */

import { Currency, QuantError, WeightRow } from './types';

export interface WeightableHolding {
  id: string;
  ticker: string;
  companyName: string;
  currency: Currency;
  marketValueNative: number;
  sector: string;
  country: string;
  portfolioId: string;
}

export function assertSingleCurrency(holdings: WeightableHolding[]): Currency {
  if (holdings.length === 0) throw new QuantError('assertSingleCurrency: no holdings');
  const currencies = new Set(holdings.map((h) => h.currency));
  if (currencies.size > 1) {
    throw new QuantError(
      `ADR-002 violation: refusing to compute weights across mixed currencies ` +
        `(${[...currencies].join(', ')}). Weight positions within one portfolio at a time.`
    );
  }
  return holdings[0].currency;
}

function totalValue(holdings: WeightableHolding[]): number {
  const total = holdings.reduce((acc, h) => acc + h.marketValueNative, 0);
  if (total === 0) throw new QuantError('weights: total portfolio value is zero');
  return total;
}

/** Weight of each individual position. */
export function positionWeights(holdings: WeightableHolding[]): WeightRow[] {
  assertSingleCurrency(holdings);
  const total = totalValue(holdings);
  return holdings
    .map((h) => ({
      key: h.id,
      label: `${h.ticker} — ${h.companyName}`,
      value: h.marketValueNative,
      weight: h.marketValueNative / total,
    }))
    .sort((a, b) => b.weight - a.weight);
}

function groupBy(
  holdings: WeightableHolding[],
  keyFn: (h: WeightableHolding) => string
): WeightRow[] {
  assertSingleCurrency(holdings);
  const total = totalValue(holdings);
  const buckets = new Map<string, number>();
  for (const h of holdings) {
    const k = keyFn(h) || 'Unclassified';
    buckets.set(k, (buckets.get(k) ?? 0) + h.marketValueNative);
  }
  return [...buckets.entries()]
    .map(([k, v]) => ({ key: k, label: k, value: v, weight: v / total }))
    .sort((a, b) => b.weight - a.weight);
}

export const sectorWeights = (h: WeightableHolding[]) => groupBy(h, (x) => x.sector);
export const countryWeights = (h: WeightableHolding[]) => groupBy(h, (x) => x.country);

/**
 * Herfindahl-Hirschman concentration index over position weights.
 * 1 / HHI gives the "effective number of positions" — a 20-position portfolio
 * with one 60% holding has an effective count far below 20, which is usually
 * more informative than the raw position count.
 */
export function concentrationHHI(holdings: WeightableHolding[]): {
  hhi: number;
  effectivePositions: number;
  largestWeight: number;
} {
  const rows = positionWeights(holdings);
  const hhi = rows.reduce((acc, r) => acc + r.weight ** 2, 0);
  return {
    hhi,
    effectivePositions: 1 / hhi,
    largestWeight: rows.length > 0 ? rows[0].weight : 0,
  };
}
