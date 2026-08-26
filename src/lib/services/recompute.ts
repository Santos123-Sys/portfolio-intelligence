/**
 * Recompute pipeline: prices -> position values -> weights -> risk metrics.
 *
 * Runs entirely inside the deterministic layer. No LLM call appears anywhere in
 * this file, and none may be added.
 */
import { eq, and, gte, desc } from 'drizzle-orm';
import { db } from '../db';
import { portfolios, positions, securities, priceHistory, riskMetrics } from '../db/schema';
import { positionWeights, WeightableHolding } from '../quant/weights';
import { toReturnSeries, timeWeightedReturn } from '../quant/returns';
import { volatility, sharpeRatio, maxDrawdown, valueAtRisk } from '../quant/risk';
import { expectedShortfall } from '../quant/tail-risk';
import { Currency, ValuationPoint } from '../quant/types';

/** Risk-free rate per currency. Replace with a live source before relying on Sharpe. */
const RISK_FREE: Record<string, number> = { CHF: 0.005, BRL: 0.105, EUR: 0.02, USD: 0.042 };

export async function recomputePositionValues(portfolioId: string) {
  const rows = await db
    .select({ positionId: positions.id, quantity: positions.quantity, securityId: securities.id, currency: securities.currency })
    .from(positions)
    .innerJoin(securities, eq(positions.securityId, securities.id))
    .where(eq(positions.portfolioId, portfolioId));

  let updated = 0;
  for (const r of rows) {
    const [latest] = await db
      .select({ close: priceHistory.close, priceDate: priceHistory.priceDate })
      .from(priceHistory)
      .where(eq(priceHistory.securityId, r.securityId))
      .orderBy(desc(priceHistory.priceDate))
      .limit(1);
    if (!latest) continue;
    const mv = Number(r.quantity) * Number(latest.close);
    await db.update(positions)
      .set({ marketValueNative: String(mv), lastPricedAt: new Date(), updatedAt: new Date() })
      .where(eq(positions.id, r.positionId));
    updated++;
  }
  return { updated, skipped: rows.length - updated };
}

export async function recomputeWeights(portfolioId: string) {
  const rows = await db
    .select({ id: positions.id, ticker: securities.ticker, companyName: securities.companyName, currency: securities.currency, marketValueNative: positions.marketValueNative, sector: securities.sector, country: securities.country, portfolioId: positions.portfolioId })
    .from(positions)
    .innerJoin(securities, eq(positions.securityId, securities.id))
    .where(eq(positions.portfolioId, portfolioId));

  const holdings: WeightableHolding[] = rows.filter((r) => r.marketValueNative !== null).map((r) => ({
    id: r.id,
    ticker: r.ticker,
    companyName: r.companyName,
    currency: r.currency as Currency,
    marketValueNative: Number(r.marketValueNative),
    sector: r.sector ?? 'Unclassified',
    country: r.country ?? 'Unknown',
    portfolioId: r.portfolioId,
  }));

  if (holdings.length === 0) return { updated: 0 };
  const weights = positionWeights(holdings);
  for (const w of weights) await db.update(positions).set({ weight: w.weight }).where(eq(positions.id, w.key));
  return { updated: weights.length };
}

export async function buildValuationSeries(portfolioId: string, fromDate: string): Promise<ValuationPoint[]> {
  const rows = await db.select({ quantity: positions.quantity, securityId: positions.securityId }).from(positions).where(eq(positions.portfolioId, portfolioId));
  const byDate = new Map<string, number>();
  for (const p of rows) {
    const bars = await db.select({ priceDate: priceHistory.priceDate, close: priceHistory.close })
      .from(priceHistory)
      .where(and(eq(priceHistory.securityId, p.securityId), gte(priceHistory.priceDate, fromDate)));
    for (const b of bars) byDate.set(b.priceDate, (byDate.get(b.priceDate) ?? 0) + Number(p.quantity) * Number(b.close));
  }
  return [...byDate.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function recomputeRiskMetrics(portfolioId: string, lookbackDays = 365) {
  const [pf] = await db.select().from(portfolios).where(eq(portfolios.id, portfolioId));
  if (!pf) throw new Error(`Portfolio ${portfolioId} not found`);

  const currency = pf.baseCurrency as Currency;
  const fromDate = new Date(Date.now() - lookbackDays * 864e5).toISOString().slice(0, 10);
  const series = await buildValuationSeries(portfolioId, fromDate);
  if (series.length < 3) return { written: 0, reason: `Only ${series.length} valuation points; need at least 3` };

  const returns = toReturnSeries(series);
  const values = series.map((p) => p.value);
  const dataAsOf = new Date(series[series.length - 1].date).toISOString();
  const ctx = { currency, dataAsOf };

  const metrics = [
    volatility(returns, ctx),
    maxDrawdown(values, ctx),
    valueAtRisk(returns, ctx, { method: 'historical', confidenceLevel: 0.95, horizonDays: 1 }),
    valueAtRisk(returns, ctx, { method: 'parametric', confidenceLevel: 0.95, horizonDays: 1 }),
    expectedShortfall(returns, ctx, 0.95),
  ];

  try { metrics.push(sharpeRatio(returns, RISK_FREE[currency] ?? 0, ctx)); } catch { /* zero volatility */ }

  const twr = timeWeightedReturn(series);
  for (const m of metrics) {
    await db.insert(riskMetrics).values({
      portfolioId, metricName: m.metricName, value: m.value, currency: m.currency,
      methodology: m.methodology, confidenceLevel: m.confidenceLevel, horizonDays: m.horizonDays,
      lookbackDays: m.lookbackDays, annualizationFactor: m.annualizationFactor, caveat: m.caveat,
      computedAt: new Date(m.computedAt), dataAsOf: new Date(m.dataAsOf),
    });
  }

  await db.insert(riskMetrics).values({
    portfolioId, metricName: 'TWR', value: twr, currency,
    methodology: `Geometrically linked sub-period returns across ${series.length} valuations, no external cash flows supplied`,
    confidenceLevel: null, horizonDays: null, lookbackDays: series.length, annualizationFactor: null,
    caveat: 'Cash flows not yet wired in; TWR equals cumulative return until transactions are loaded',
    computedAt: new Date(), dataAsOf: new Date(dataAsOf),
  });

  return { written: metrics.length + 1, currency, observations: returns.length };
}

export async function recomputeAll() {
  const all = await db.select().from(portfolios);
  const results = [];
  for (const pf of all) {
    const values = await recomputePositionValues(pf.id);
    const weights = await recomputeWeights(pf.id);
    const risk = await recomputeRiskMetrics(pf.id);
    results.push({ portfolioId: pf.id, name: pf.name, values, weights, risk });
  }
  return results;
}
