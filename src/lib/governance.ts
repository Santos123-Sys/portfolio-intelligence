import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import {
  aiAnalyses,
  alerts,
  decisionLog,
  governancePolicies,
  portfolios,
  positions,
  priceHistory,
  riskMetrics,
  securities,
  thesisVersions,
} from './db/schema';
import {
  discoveryCandidates,
  marketDataObservations,
  providerCalls,
  valuationScenarios,
} from './db/workflow-schema';

export const defaultGovernancePolicy = {
  maxPositionWeight: 0.15,
  maxSectorWeight: 0.35,
  maxCountryWeight: 0.40,
  minimumHoldings: 5,
  stalePriceDays: 7,
  staleResearchDays: 90,
  reviewIntervalDays: 30,
};

export type GovernancePolicy = typeof defaultGovernancePolicy;
type Severity = 'info' | 'watch' | 'breach';

function ageDays(value: Date | string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.floor((now - time) / 86_400_000)) : null;
}

function severityRank(value: Severity): number {
  return value === 'breach' ? 2 : value === 'watch' ? 1 : 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asJournal(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const journal = value as Record<string, unknown>;
  const fields = ['decisionReason', 'expectedHoldingPeriod', 'valuationView', 'principalRisk', 'invalidationTrigger'];
  if (!fields.every((field) => typeof journal[field] === 'string')) return null;
  return Object.fromEntries(fields.map((field) => [field, String(journal[field])])) as Record<string, string>;
}

export async function getGovernancePolicy(ownerId: string): Promise<GovernancePolicy> {
  const [policy] = await db.select().from(governancePolicies).where(eq(governancePolicies.ownerId, ownerId)).limit(1);
  if (!policy) return defaultGovernancePolicy;
  return {
    maxPositionWeight: policy.maxPositionWeight,
    maxSectorWeight: policy.maxSectorWeight,
    maxCountryWeight: policy.maxCountryWeight,
    minimumHoldings: policy.minimumHoldings,
    stalePriceDays: policy.stalePriceDays,
    staleResearchDays: policy.staleResearchDays,
    reviewIntervalDays: policy.reviewIntervalDays,
  };
}

export async function saveGovernancePolicy(ownerId: string, policy: GovernancePolicy) {
  const [saved] = await db.insert(governancePolicies).values({ ownerId, ...policy, updatedAt: new Date() })
    .onConflictDoUpdate({ target: governancePolicies.ownerId, set: { ...policy, updatedAt: new Date() } }).returning();
  return saved;
}

/**
 * Produces an owner-scoped control pack from persisted evidence. It deliberately
 * creates review prompts rather than orders: these thresholds are governance
 * guardrails, not an autonomous trading system.
 */
export async function buildGovernanceDashboard(ownerId: string) {
  const policy = await getGovernancePolicy(ownerId);
  const ownedPortfolios = await db.select().from(portfolios).where(eq(portfolios.ownerId, ownerId));
  const portfolioIds = ownedPortfolios.map((portfolio) => portfolio.id);
  const holdings = portfolioIds.length ? await db.select({
    positionId: positions.id,
    portfolioId: positions.portfolioId,
    quantity: positions.quantity,
    marketValueNative: positions.marketValueNative,
    weight: positions.weight,
    lastPricedAt: positions.lastPricedAt,
    securityId: securities.id,
    ticker: securities.ticker,
    companyName: securities.companyName,
    currency: securities.currency,
    sector: securities.sector,
    country: securities.country,
  }).from(positions).innerJoin(securities, eq(positions.securityId, securities.id))
    .where(inArray(positions.portfolioId, portfolioIds)) : [];
  const securityIds = [...new Set(holdings.map((holding) => holding.securityId))];
  const [analysisRows, priceRows, observationRows, riskRows, candidates, valuations, ownedAlerts, decisions, theses, providerRows] = await Promise.all([
    securityIds.length ? db.select().from(aiAnalyses).where(and(eq(aiAnalyses.ownerId, ownerId), inArray(aiAnalyses.securityId, securityIds))).orderBy(desc(aiAnalyses.analysisTimestamp)) : [],
    securityIds.length ? db.select().from(priceHistory).where(inArray(priceHistory.securityId, securityIds)).orderBy(desc(priceHistory.priceDate)) : [],
    securityIds.length ? db.select().from(marketDataObservations).where(inArray(marketDataObservations.securityId, securityIds)).orderBy(desc(marketDataObservations.retrievedAt)) : [],
    portfolioIds.length ? db.select().from(riskMetrics).where(inArray(riskMetrics.portfolioId, portfolioIds)).orderBy(desc(riskMetrics.computedAt)) : [],
    db.select().from(discoveryCandidates).where(eq(discoveryCandidates.ownerId, ownerId)).orderBy(desc(discoveryCandidates.updatedAt)),
    db.select().from(valuationScenarios).where(eq(valuationScenarios.ownerId, ownerId)).orderBy(desc(valuationScenarios.createdAt)),
    db.select().from(alerts).where(eq(alerts.ownerId, ownerId)).orderBy(desc(alerts.createdAt)),
    db.select().from(decisionLog).where(eq(decisionLog.ownerId, ownerId)).orderBy(desc(decisionLog.decisionDate)).limit(20),
    db.select().from(thesisVersions).where(eq(thesisVersions.ownerId, ownerId)).orderBy(desc(thesisVersions.versionNumber)),
    db.select().from(providerCalls).orderBy(desc(providerCalls.calledAt)).limit(250),
  ]);

  const latestAnalysis = new Map<string, typeof analysisRows[number]>();
  for (const row of analysisRows) {
    const key = `${row.portfolioId}:${row.securityId}`;
    if (!latestAnalysis.has(key)) latestAnalysis.set(key, row);
  }
  const latestPrice = new Map<string, typeof priceRows[number]>();
  for (const row of priceRows) if (!latestPrice.has(row.securityId)) latestPrice.set(row.securityId, row);
  const latestObservation = new Map<string, typeof observationRows[number]>();
  for (const row of observationRows) if (!latestObservation.has(row.securityId)) latestObservation.set(row.securityId, row);
  const latestRisk = new Map<string, typeof riskRows[number]>();
  for (const row of riskRows) {
    const key = `${row.portfolioId}:${row.metricName}`;
    if (!latestRisk.has(key)) latestRisk.set(key, row);
  }
  const portfolioById = new Map(ownedPortfolios.map((portfolio) => [portfolio.id, portfolio]));

  const reviewQueue: Array<{ severity: Severity; title: string; detail: string; portfolioName: string | null; ticker: string | null; category: string }> = [];
  const freshness = holdings.map((holding) => {
    const portfolio = portfolioById.get(holding.portfolioId)!;
    const price = latestPrice.get(holding.securityId);
    const analysis = latestAnalysis.get(`${holding.portfolioId}:${holding.securityId}`);
    const observation = latestObservation.get(holding.securityId);
    const priceAgeDays = ageDays(price?.priceDate);
    const analysisAgeDays = ageDays(analysis?.dataTimestamp ?? analysis?.analysisTimestamp);
    const evidenceAgeDays = ageDays(observation?.retrievedAt);
    if (priceAgeDays == null || priceAgeDays > policy.stalePriceDays) reviewQueue.push({
      severity: 'breach', title: `${holding.ticker}: price evidence is stale`,
      detail: priceAgeDays == null ? 'No stored closing price is available.' : `Latest close is ${priceAgeDays} days old; policy threshold is ${policy.stalePriceDays}.`,
      portfolioName: portfolio.name, ticker: holding.ticker, category: 'Freshness',
    });
    if (!analysis || analysisAgeDays == null || analysisAgeDays > policy.staleResearchDays) reviewQueue.push({
      severity: 'watch', title: `${holding.ticker}: research review is due`,
      detail: !analysis ? 'No linked analysis is available for this holding.' : `Research evidence is ${analysisAgeDays} days old; policy threshold is ${policy.staleResearchDays}.`,
      portfolioName: portfolio.name, ticker: holding.ticker, category: 'Research',
    });
    const breakers = asStringArray(analysis?.thesisBreakers);
    if (breakers.length) reviewQueue.push({
      severity: 'watch', title: `${holding.ticker}: thesis breakers require monitoring`,
      detail: breakers.join(' · '), portfolioName: portfolio.name, ticker: holding.ticker, category: 'Thesis',
    });
    return {
      portfolioName: portfolio.name, ticker: holding.ticker, companyName: holding.companyName,
      priceAgeDays, analysisAgeDays, evidenceAgeDays,
      priceStatus: priceAgeDays != null && priceAgeDays <= policy.stalePriceDays ? 'current' : 'stale',
      evidenceStatus: evidenceAgeDays != null && evidenceAgeDays <= policy.staleResearchDays ? 'current' : 'stale',
      analysisStatus: analysisAgeDays != null && analysisAgeDays <= policy.staleResearchDays ? 'current' : 'review due',
      lastPriceDate: price?.priceDate ?? null,
      latestProvider: observation?.provider ?? null,
    };
  });

  const construction = ownedPortfolios.map((portfolio) => {
    const rows = holdings.filter((holding) => holding.portfolioId === portfolio.id);
    const weightTotal = rows.reduce((sum, row) => sum + (row.weight ?? 0), 0);
    const canUseStoredWeights = rows.length > 0 && rows.every((row) => row.weight != null) && Math.abs(weightTotal - 1) < 0.02;
    const valuesAreComparable = rows.every((row) => row.currency === portfolio.baseCurrency && row.marketValueNative != null);
    const totalValue = valuesAreComparable ? rows.reduce((sum, row) => sum + Number(row.marketValueNative), 0) : null;
    const normalized = rows.map((row) => ({ ...row, effectiveWeight: row.weight ?? (totalValue && totalValue > 0 ? Number(row.marketValueNative) / totalValue : null) }));
    const sectors = new Map<string, number>();
    const countries = new Map<string, number>();
    for (const holding of normalized) {
      if (holding.effectiveWeight == null) continue;
      sectors.set(holding.sector ?? 'Unclassified', (sectors.get(holding.sector ?? 'Unclassified') ?? 0) + holding.effectiveWeight);
      countries.set(holding.country ?? 'Unknown', (countries.get(holding.country ?? 'Unknown') ?? 0) + holding.effectiveWeight);
    }
    const issues: Array<{ severity: Severity; label: string; detail: string }> = [];
    if (rows.length > 0 && rows.length < policy.minimumHoldings) issues.push({ severity: 'watch', label: 'Diversification', detail: `${rows.length} holdings vs baseline minimum of ${policy.minimumHoldings}.` });
    for (const holding of normalized) if ((holding.effectiveWeight ?? 0) > policy.maxPositionWeight) issues.push({ severity: 'breach', label: `${holding.ticker} concentration`, detail: `${((holding.effectiveWeight ?? 0) * 100).toFixed(1)}% exceeds ${(policy.maxPositionWeight * 100).toFixed(1)}% baseline.` });
    for (const [sector, weight] of sectors) if (weight > policy.maxSectorWeight) issues.push({ severity: 'watch', label: `${sector} sector`, detail: `${(weight * 100).toFixed(1)}% exceeds ${(policy.maxSectorWeight * 100).toFixed(1)}% baseline.` });
    for (const [country, weight] of countries) if (weight > policy.maxCountryWeight) issues.push({ severity: 'watch', label: `${country} country`, detail: `${(weight * 100).toFixed(1)}% exceeds ${(policy.maxCountryWeight * 100).toFixed(1)}% baseline.` });
    for (const issue of issues) reviewQueue.push({ severity: issue.severity, title: `${portfolio.name}: ${issue.label}`, detail: issue.detail, portfolioName: portfolio.name, ticker: null, category: 'Construction' });
    const attribution = [...latestRisk.values()].filter((metric) => metric.portfolioId === portfolio.id && metric.metricName.startsWith('ReturnContribution_'))
      .map((metric) => ({ ticker: metric.metricName.replace('ReturnContribution_', ''), contribution: metric.value, dataAsOf: metric.dataAsOf?.toISOString() ?? null }))
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    return {
      portfolioName: portfolio.name, currency: portfolio.baseCurrency, holdingCount: rows.length,
      weightsAvailable: canUseStoredWeights || totalValue != null,
      issues, sectors: [...sectors.entries()].map(([name, weight]) => ({ name, weight })).sort((a, b) => b.weight - a.weight),
      countries: [...countries.entries()].map(([name, weight]) => ({ name, weight })).sort((a, b) => b.weight - a.weight),
      holdings: normalized.map((holding) => ({ ticker: holding.ticker, companyName: holding.companyName, weight: holding.effectiveWeight })).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)),
      attribution,
      riskAsOf: latestRisk.get(`${portfolio.id}:TWR`)?.dataAsOf?.toISOString() ?? null,
    };
  });

  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (const alert of ownedAlerts.filter((alert) => !alert.acknowledgedAt)) reviewQueue.push({ severity: alert.severity as Severity, title: alert.headline, detail: alert.detail ?? 'Review the recorded alert.', portfolioName: alert.portfolioId ? portfolioById.get(alert.portfolioId)?.name ?? null : null, ticker: null, category: 'Alert' });
  for (const candidate of candidates.filter((candidate) => candidate.decision === 'watchlist')) reviewQueue.push({ severity: 'info', title: `${candidate.companyName}: watchlist review`, detail: candidate.rationale ?? 'Candidate remains on watchlist.', portfolioName: portfolioById.get(candidate.portfolioId)?.name ?? null, ticker: candidate.ticker, category: 'Watchlist' });
  for (const candidate of candidates.filter((candidate) => candidate.decision === 'approved')) {
    const decisionAge = ageDays(candidate.decidedAt);
    if (decisionAge != null && decisionAge >= policy.reviewIntervalDays) reviewQueue.push({
      severity: 'info', title: `${candidate.companyName}: scheduled decision review`,
      detail: `Approval is ${decisionAge} days old; policy review interval is ${policy.reviewIntervalDays} days.`,
      portfolioName: portfolioById.get(candidate.portfolioId)?.name ?? null, ticker: candidate.ticker, category: 'Scheduled review',
    });
  }
  for (const valuation of valuations) {
    const valuationAge = ageDays(valuation.createdAt);
    if (valuationAge != null && valuationAge >= policy.reviewIntervalDays) reviewQueue.push({
      severity: 'info', title: `${candidateById.get(valuation.candidateId)?.companyName ?? 'Candidate'}: valuation review`,
      detail: `Valuation scenario is ${valuationAge} days old; policy review interval is ${policy.reviewIntervalDays} days.`,
      portfolioName: candidateById.get(valuation.candidateId) ? portfolioById.get(candidateById.get(valuation.candidateId)!.portfolioId)?.name ?? null : null,
      ticker: candidateById.get(valuation.candidateId)?.ticker ?? null, category: 'Valuation',
    });
  }

  const committeeMemos = candidates.filter((candidate) => candidate.decision === 'approved' || candidate.decision === 'watchlist').slice(0, 20).map((candidate) => {
    const analysis = candidate.securityId ? latestAnalysis.get(`${candidate.portfolioId}:${candidate.securityId}`) : null;
    const latestValuation = valuations.find((valuation) => valuation.candidateId === candidate.id) ?? null;
    const journal = asJournal(candidate.decisionJournal);
    const dcf = latestValuation?.method === 'two_stage_fcff' ? latestValuation.resultJson as { currency?: string; fairValuePerShare?: number; terminalPresentValue?: number; enterpriseValue?: number; caveats?: string[] } : null;
    const terminalShare = dcf?.terminalPresentValue != null && dcf.enterpriseValue ? dcf.terminalPresentValue / dcf.enterpriseValue : null;
    return {
      candidateId: candidate.id, companyName: candidate.companyName, ticker: candidate.ticker, portfolioName: portfolioById.get(candidate.portfolioId)?.name ?? 'Unknown portfolio', decision: candidate.decision,
      thesisVersion: analysis ? theses.find((thesis) => thesis.id === analysis.thesisVersionId)?.versionNumber ?? null : null,
      investmentThesis: analysis?.investmentThesis ?? candidate.rationale,
      catalysts: asStringArray(analysis?.keyCatalysts), risks: asStringArray(analysis?.keyRisks), gaps: asStringArray(analysis?.informationGaps),
      evidenceAsOf: analysis?.dataTimestamp?.toISOString() ?? analysis?.analysisTimestamp?.toISOString() ?? null,
      valuation: dcf?.fairValuePerShare != null ? { currency: dcf.currency ?? candidate.currency, fairValuePerShare: dcf.fairValuePerShare, terminalShare, caveats: dcf.caveats ?? [] } : null,
      journal, decisionDate: candidate.decidedAt?.toISOString() ?? null,
    };
  });

  const providerHealth = [...providerRows.reduce((map, row) => {
    const key = `${row.provider}:${row.endpoint}`;
    const item = map.get(key) ?? { provider: row.provider, endpoint: row.endpoint, ok: 0, errors: 0, planLimits: 0, rateLimited: 0, lastCalledAt: row.calledAt.toISOString() };
    if (row.outcome === 'ok') item.ok += 1;
    else if (row.outcome === 'plan_limit') item.planLimits += 1;
    else if (row.outcome === 'rate_limited') item.rateLimited += 1;
    else item.errors += 1;
    map.set(key, item);
    return map;
  }, new Map<string, { provider: string; endpoint: string; ok: number; errors: number; planLimits: number; rateLimited: number; lastCalledAt: string }>()).values()]
    .sort((a, b) => new Date(b.lastCalledAt).getTime() - new Date(a.lastCalledAt).getTime());

  reviewQueue.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.title.localeCompare(b.title));
  return {
    generatedAt: new Date().toISOString(), policy, construction, freshness,
    reviewQueue, providerHealth, committeeMemos,
    valuationCoverage: {
      total: valuations.length,
      dcf: valuations.filter((valuation) => valuation.method === 'two_stage_fcff').length,
      comparables: valuations.filter((valuation) => valuation.method !== 'two_stage_fcff').length,
      latest: valuations.slice(0, 10).map((valuation) => ({ candidate: candidateById.get(valuation.candidateId)?.companyName ?? 'Unknown company', method: valuation.method, createdAt: valuation.createdAt.toISOString(), status: valuation.status })),
    },
    versioning: {
      thesisVersions: theses.map((thesis) => ({ version: thesis.versionNumber, effectiveDate: thesis.effectiveDate.toISOString(), supersededAt: thesis.supersededAt?.toISOString() ?? null, excludedAt: thesis.excludedAt?.toISOString() ?? null })),
      decisions: decisions.map((decision) => ({ title: decision.title, decision: decision.decision, date: decision.decisionDate.toISOString(), metadata: decision.metadata ?? null })),
    },
    monitoringCoverage: [
      { capability: 'Price freshness', status: 'active', detail: 'Derived from stored close observations.' },
      { capability: 'Research freshness', status: 'active', detail: 'Derived from analysis and evidence timestamps.' },
      { capability: 'Thesis-breaker review', status: 'active', detail: 'Recorded thesis breakers enter the review queue.' },
      { capability: 'Earnings, leverage, management events', status: 'not_connected', detail: 'Requires an event or filing-change feed; no event is inferred without a source.' },
    ],
  };
}
