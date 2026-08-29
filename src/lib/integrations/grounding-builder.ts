import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  AgenticRunRequest,
  AgenticRunSelection,
  ThesisCriteria,
  validateRunRequestCoherence,
  type GroundingBundle,
} from '@portfolio-intelligence/agentic-contract';
import { db } from '@/lib/db';
import { portfolios, positions, riskMetrics, securities, thesisVersions } from '@/lib/db/schema';
import { marketDataObservations } from '@/lib/db/workflow-schema';
import { assessAgenticReadiness, type AgenticReadiness } from '@/lib/portfolio-setup';

interface HoldingEvidence {
  positionId: string;
  portfolioId: string;
  quantity: string;
  avgCost: string;
  marketValueNative: string | null;
  weight: number | null;
  updatedAt: Date;
  lastPricedAt: Date | null;
  securityId: string;
  ticker: string;
  companyName: string;
  exchange: string;
  currency: string;
  sector: string | null;
  country: string | null;
}

interface RiskEvidence {
  portfolioId: string;
  metricName: string;
  value: number;
  computedAt: Date;
  dataAsOf: Date | null;
}

interface FundamentalEvidence {
  id: string;
  securityId: string;
  metricName: string;
  valueNumeric: string | null;
  valueText: string | null;
  observationDate: string | null;
  retrievedAt: Date;
}

function finiteNumber(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestIso(dates: Array<Date | null | undefined>): string {
  return new Date(Math.max(...dates.filter((date): date is Date => date instanceof Date).map((date) => date.getTime())))
    .toISOString();
}

export function assembleGroundingBundle(
  holding: HoldingEvidence,
  risks: RiskEvidence[],
  fundamentals: FundamentalEvidence[]
): GroundingBundle {
  const computedMetrics: Record<string, number> = {
    [`position:quantity:${holding.positionId}`]: Number(holding.quantity),
    [`position:average_cost:${holding.positionId}`]: Number(holding.avgCost),
  };
  if (holding.marketValueNative != null) {
    computedMetrics[`position:market_value_native:${holding.positionId}`] = Number(holding.marketValueNative);
  }
  if (holding.weight != null) computedMetrics[`position:weight:${holding.positionId}`] = holding.weight;
  for (const risk of risks) {
    computedMetrics[`portfolioRiskMetric:${risk.metricName}:${risk.computedAt.toISOString()}`] = risk.value;
  }

  const fundamentalValues: GroundingBundle['fundamentals'] = {};
  const seen = new Set<string>();
  for (const observation of fundamentals) {
    if (seen.has(observation.metricName)) continue;
    seen.add(observation.metricName);
    const numeric = finiteNumber(observation.valueNumeric);
    fundamentalValues[`fundamental:${observation.metricName}:${observation.id}`] =
      numeric ?? observation.valueText ?? null;
  }

  return {
    ticker: holding.ticker,
    companyName: holding.companyName,
    exchange: holding.exchange,
    currency: holding.currency,
    sector: holding.sector,
    country: holding.country,
    computedMetrics,
    dataAsOf: latestIso([
      holding.updatedAt,
      holding.lastPricedAt,
      ...risks.flatMap((risk) => [risk.computedAt, risk.dataAsOf]),
      ...fundamentals.map((observation) => observation.retrievedAt),
    ]),
    fundamentals: fundamentalValues,
  };
}

export async function getAgenticReadiness(ownerId: string): Promise<AgenticReadiness> {
  const [latestThesis, ownerPortfolios, ownerPositions] = await Promise.all([
    db.select({ versionNumber: thesisVersions.versionNumber })
      .from(thesisVersions)
      .where(eq(thesisVersions.ownerId, ownerId))
      .orderBy(desc(thesisVersions.versionNumber))
      .limit(1),
    db.select({ id: portfolios.id, name: portfolios.name })
      .from(portfolios)
      .where(eq(portfolios.ownerId, ownerId)),
    db.select({ portfolioId: positions.portfolioId })
      .from(positions)
      .innerJoin(portfolios, eq(positions.portfolioId, portfolios.id))
      .where(eq(portfolios.ownerId, ownerId)),
  ]);

  return assessAgenticReadiness({
    thesisVersion: latestThesis[0]?.versionNumber ?? null,
    portfolios: ownerPortfolios,
    positionPortfolioIds: ownerPositions.map((position) => position.portfolioId),
  });
}

export async function buildAgenticRunRequest(
  ownerId: string,
  input: AgenticRunSelection
): Promise<AgenticRunRequest> {
  const selection = AgenticRunSelection.parse(input);
  const [thesis] = await db
    .select()
    .from(thesisVersions)
    .where(selection.thesisVersionId
      ? and(eq(thesisVersions.ownerId, ownerId), eq(thesisVersions.id, selection.thesisVersionId))
      : eq(thesisVersions.ownerId, ownerId))
    .orderBy(desc(thesisVersions.versionNumber))
    .limit(1);
  if (!thesis) throw new Error('Create and confirm an investment thesis before starting analysis');
  const criteria = ThesisCriteria.parse(thesis.criteriaJson);
  if (criteria.version !== thesis.versionNumber) {
    throw new Error('Confirmed thesis criteria version does not match its dashboard record');
  }

  const ownerPortfolios = await db
    .select()
    .from(portfolios)
    .where(selection.portfolioIds
      ? and(eq(portfolios.ownerId, ownerId), inArray(portfolios.id, selection.portfolioIds))
      : eq(portfolios.ownerId, ownerId));
  if (selection.portfolioIds && ownerPortfolios.length !== new Set(selection.portfolioIds).size) {
    throw new Error('One or more selected portfolios are unavailable');
  }
  if (!ownerPortfolios.length) throw new Error('Create a portfolio before starting analysis');
  const portfolioIds = ownerPortfolios.map((portfolio) => portfolio.id);

  const holdings = await db
    .select({
      positionId: positions.id,
      portfolioId: positions.portfolioId,
      quantity: positions.quantity,
      avgCost: positions.avgCost,
      marketValueNative: positions.marketValueNative,
      weight: positions.weight,
      updatedAt: positions.updatedAt,
      lastPricedAt: positions.lastPricedAt,
      securityId: securities.id,
      ticker: securities.ticker,
      companyName: securities.companyName,
      exchange: securities.exchange,
      currency: securities.currency,
      sector: securities.sector,
      country: securities.country,
    })
    .from(positions)
    .innerJoin(securities, eq(positions.securityId, securities.id))
    .where(inArray(positions.portfolioId, portfolioIds));
  if (!holdings.length) throw new Error('No positions are available for analysis');
  const portfoliosWithHoldings = new Set(holdings.map((holding) => holding.portfolioId));
  const emptyPortfolio = ownerPortfolios.find((portfolio) => !portfoliosWithHoldings.has(portfolio.id));
  if (emptyPortfolio) throw new Error(`Portfolio ${emptyPortfolio.name} has no positions to analyze`);

  const [riskRows, observationRows] = await Promise.all([
    db.select({
      portfolioId: riskMetrics.portfolioId,
      metricName: riskMetrics.metricName,
      value: riskMetrics.value,
      computedAt: riskMetrics.computedAt,
      dataAsOf: riskMetrics.dataAsOf,
    }).from(riskMetrics)
      .where(inArray(riskMetrics.portfolioId, portfolioIds))
      .orderBy(desc(riskMetrics.computedAt)),
    db.select({
      id: marketDataObservations.id,
      securityId: marketDataObservations.securityId,
      metricName: marketDataObservations.metricName,
      valueNumeric: marketDataObservations.valueNumeric,
      valueText: marketDataObservations.valueText,
      observationDate: marketDataObservations.observationDate,
      retrievedAt: marketDataObservations.retrievedAt,
    }).from(marketDataObservations)
      .where(and(
        inArray(marketDataObservations.securityId, holdings.map((holding) => holding.securityId)),
        eq(marketDataObservations.observationType, 'fundamental'),
        eq(marketDataObservations.status, 'OK')
      ))
      .orderBy(desc(marketDataObservations.retrievedAt)),
  ]);

  const request = AgenticRunRequest.parse({
    thesis: { versionId: thesis.id, criteria },
    portfolios: ownerPortfolios.map((portfolio) => ({
      id: portfolio.id,
      name: portfolio.name,
      baseCurrency: portfolio.baseCurrency,
      investmentObjective: portfolio.investmentObjective ?? '',
    })),
    securities: holdings.map((holding) => ({
      ticker: holding.ticker,
      exchange: holding.exchange,
      portfolioId: holding.portfolioId,
    })),
    groundingBundles: holdings.map((holding) => ({
      portfolioId: holding.portfolioId,
      bundle: assembleGroundingBundle(
        holding,
        riskRows.filter((risk) => risk.portfolioId === holding.portfolioId),
        observationRows.filter((observation) => observation.securityId === holding.securityId)
      ),
    })),
  });
  validateRunRequestCoherence(request);
  return request;
}
