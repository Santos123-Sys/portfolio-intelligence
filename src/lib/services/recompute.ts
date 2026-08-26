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
import { Currency, TRADING_DAYS, ValuationPoint } from '../quant/types';
import {
  beta,
  componentRiskContribution,
  concentrationHerfindahl,
  covarianceMatrix,
  sortinoRatio,
} from '../quant/portfolio-risk';
import { singlePeriodReturnAttribution, totalAttributedReturn } from '../quant/attribution';

/** Risk-free rate per currency. Replace with a live source before relying on Sharpe/Sortino. */
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

interface SecuritySeries {
  ticker: string;
  securityId: string;
  quantity: number;
  weight: number;
  prices: ValuationPoint[];
  returns: number[];
}

async function buildSecuritySeries(portfolioId: string, fromDate: string): Promise<SecuritySeries[]> {
  const holdings = await db
    .select({
      ticker: securities.ticker,
      securityId: securities.id,
      quantity: positions.quantity,
      weight: positions.weight,
    })
    .from(positions)
    .innerJoin(securities, eq(positions.securityId, securities.id))
    .where(eq(positions.portfolioId, portfolioId));

  const out: SecuritySeries[] = [];
  for (const h of holdings) {
    const bars = await db
      .select({ priceDate: priceHistory.priceDate, close: priceHistory.close })
      .from(priceHistory)
      .where(and(eq(priceHistory.securityId, h.securityId), gte(priceHistory.priceDate, fromDate)));
    const prices = bars
      .map((b) => ({ date: b.priceDate, value: Number(b.close) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (prices.length < 3) continue;
    out.push({
      ticker: h.ticker,
      securityId: h.securityId,
      quantity: Number(h.quantity),
      weight: Number(h.weight ?? 0),
      prices,
      returns: toReturnSeries(prices),
    });
  }
  return out;
}

function trailingAligned(series: number[][]): number[][] {
  const min = Math.min(...series.map((s) => s.length));
  return series.map((s) => s.slice(s.length - min));
}

async function insertKpi(
  portfolioId: string,
  metricName: string,
  value: number,
  currency: Currency,
  methodology: string,
  dataAsOf: string,
  lookbackDays: number,
  caveat: string | null = null
) {
  if (!Number.isFinite(value)) return;
  await db.insert(riskMetrics).values({
    portfolioId,
    metricName,
    value,
    currency,
    methodology,
    confidenceLevel: null,
    horizonDays: null,
    lookbackDays,
    annualizationFactor: null,
    caveat,
    computedAt: new Date(),
    dataAsOf: new Date(dataAsOf),
  });
}

async function recomputeAdvancedRiskMetrics(portfolioId: string, currency: Currency, fromDate: string, portfolioReturns: number[], dataAsOf: string) {
  const securitySeries = await buildSecuritySeries(portfolioId, fromDate);
  if (securitySeries.length === 0) return 0;

  let written = 0;
  const weights = securitySeries.map((s) => s.weight).filter((w) => w > 0);
  if (weights.length > 0) {
    await insertKpi(
      portfolioId,
      'Concentration_HHI',
      concentrationHerfindahl(weights),
      currency,
      'Herfindahl-Hirschman concentration index calculated from current position weights: sum(weight^2)',
      dataAsOf,
      weights.length
    );
    written++;
  }

  const alignedInput = trailingAligned([portfolioReturns, ...securitySeries.map((s) => s.returns)]);
  const alignedPortfolio = alignedInput[0];
  const alignedSecurities = securitySeries.map((s, i) => ({ ...s, returns: alignedInput[i + 1] }));

  for (const s of alignedSecurities) {
    if (s.returns.length < 3) continue;
    try {
      await insertKpi(
        portfolioId,
        `Beta_to_Portfolio_${s.ticker}`,
        beta(s.returns, alignedPortfolio),
        currency,
        `Covariance(${s.ticker}, portfolio returns) / variance(portfolio returns), using trailing aligned daily returns`,
        dataAsOf,
        s.returns.length,
        'Beta is measured to this portfolio, not to an external benchmark index'
      );
      written++;
    } catch { /* insufficient or zero variance */ }
  }

  if (alignedSecurities.length >= 2) {
    const returnMap: Record<string, number[]> = {};
    const weightMap: Record<string, number> = {};
    for (const s of alignedSecurities) {
      returnMap[s.ticker] = s.returns;
      weightMap[s.ticker] = s.weight;
    }
    try {
      const matrix = covarianceMatrix(returnMap);
      const keys = Object.keys(matrix);
      for (let i = 0; i < keys.length; i++) {
        for (let j = i; j < keys.length; j++) {
          await insertKpi(
            portfolioId,
            `Covariance_${keys[i]}_${keys[j]}`,
            matrix[keys[i]][keys[j]],
            currency,
            'Sample covariance of aligned daily security return series',
            dataAsOf,
            returnMap[keys[i]].length
          );
          written++;
        }
      }
      const riskContribution = componentRiskContribution(weightMap, matrix);
      for (const [ticker, contribution] of Object.entries(riskContribution)) {
        await insertKpi(
          portfolioId,
          `RiskContribution_${ticker}`,
          contribution,
          currency,
          'Component contribution to portfolio variance: weight × marginal variance contribution / portfolio variance',
          dataAsOf,
          returnMap[ticker].length
        );
        written++;
      }
    } catch { /* covariance/risk contribution undefined on insufficient series */ }
  }

  const attributionInputs = securitySeries
    .filter((s) => s.weight > 0 && s.prices.length >= 2)
    .map((s) => {
      const first = s.prices[0];
      const last = s.prices[s.prices.length - 1];
      return {
        key: s.ticker,
        startingWeight: s.weight,
        startValue: first.value * s.quantity,
        endValue: last.value * s.quantity,
      };
    });
  if (attributionInputs.length > 0) {
    try {
      const attribution = singlePeriodReturnAttribution(attributionInputs);
      for (const item of attribution) {
        await insertKpi(
          portfolioId,
          `ReturnContribution_${item.key}`,
          item.contribution,
          currency,
          'Single-period arithmetic attribution: starting weight × holding return; no external cash flows supplied',
          dataAsOf,
          portfolioReturns.length,
          'Attribution is approximate until transaction-level cash flows are fully incorporated'
        );
        written++;
      }
      await insertKpi(
        portfolioId,
        'AttributedReturn_Total',
        totalAttributedReturn(attribution),
        currency,
        'Sum of position-level return contributions over the available lookback window',
        dataAsOf,
        portfolioReturns.length,
        'Attribution is approximate until transaction-level cash flows are fully incorporated'
      );
      written++;
    } catch { /* attribution requires non-zero start values */ }
  }

  return written;
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
  try {
    const rfPeriodic = Math.pow(1 + (RISK_FREE[currency] ?? 0), 1 / TRADING_DAYS) - 1;
    metrics.push({
      metricName: 'Sortino',
      value: sortinoRatio(returns, rfPeriodic) * Math.sqrt(TRADING_DAYS),
      currency,
      methodology: `Annualized Sortino ratio using downside deviation below the ${currency} periodic risk-free rate`,
      confidenceLevel: null,
      horizonDays: null,
      lookbackDays: returns.length,
      annualizationFactor: TRADING_DAYS,
      computedAt: new Date().toISOString(),
      dataAsOf,
      caveat: returns.length < 60 ? `Only ${returns.length} observations; Sortino is unstable on short samples` : null,
    });
  } catch { /* zero downside deviation */ }

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

  const advancedWritten = await recomputeAdvancedRiskMetrics(portfolioId, currency, fromDate, returns, dataAsOf);

  return { written: metrics.length + 1 + advancedWritten, currency, observations: returns.length };
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
