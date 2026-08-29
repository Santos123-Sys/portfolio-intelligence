import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  AgenticRunRequest,
  DiscoveryCandidate,
  DiscoveryRunRequest,
  MarketDiscoveryOutput,
  PortfolioRole,
  ThesisCriteria,
  validateDiscoveryOutput,
  validateRunRequestCoherence,
  type DiscoveryRunStatus,
  type GroundingBundle,
} from '@portfolio-intelligence/agentic-contract';
import { getActiveAgentCustomization } from './agent-config';
import { getPriceProvider } from './connectors';
import { db } from './db';
import { aiAnalyses, portfolios, priceHistory, securities, thesisVersions } from './db/schema';
import {
  discoveryCandidates,
  externalAgenticRuns,
  externalDiscoveryRuns,
  marketDataObservations,
  securityRiskSnapshots,
} from './db/workflow-schema';
import { startExternalAgenticRun } from './integrations/agentic-client';
import { computeStandaloneSecurityRisk } from './quant/security-risk';
import { recordFundamentalObservations, recordPriceObservation } from './services/provenance';

const ROLE_EXCHANGE: Partial<Record<PortfolioRole, string>> = {
  swiss_quality: 'XSWX',
  brazilian_growth: 'BVMF',
};

function uniqueBy<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const value = key(row);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export async function buildDiscoveryRunRequest(
  ownerId: string,
  maxCandidatesPerPortfolio = 8
): Promise<{ request: DiscoveryRunRequest; provider: string; thesisVersionId: string }> {
  const [thesis, ownerPortfolios, agentConfig] = await Promise.all([
    db.select().from(thesisVersions).where(and(
      eq(thesisVersions.ownerId, ownerId),
      isNull(thesisVersions.excludedAt)
    ))
      .orderBy(desc(thesisVersions.versionNumber)).limit(1).then((rows) => rows[0]),
    db.select().from(portfolios).where(eq(portfolios.ownerId, ownerId)),
    getActiveAgentCustomization(ownerId, 'market_research'),
  ]);
  if (!thesis) throw new Error('Confirm an investment thesis before starting stock discovery');
  const criteria = ThesisCriteria.parse(thesis.criteriaJson);
  if (criteria.version !== thesis.versionNumber) throw new Error('Confirmed thesis version is inconsistent');

  const criteriaByRole = new Map<PortfolioRole, ThesisCriteria['portfolios'][number]>();
  for (const mandate of criteria.portfolios) {
    if (criteriaByRole.has(mandate.role)) {
      throw new Error(`Confirmed thesis contains duplicate ${mandate.role} mandates`);
    }
    criteriaByRole.set(mandate.role, mandate);
  }

  const equityPortfolios = ownerPortfolios.flatMap((portfolio) => {
    const role = PortfolioRole.safeParse(portfolio.portfolioType);
    if (!role.success || !ROLE_EXCHANGE[role.data]) return [];
    const mandate = criteriaByRole.get(role.data);
    if (!mandate) return [];
    const thesisCurrency = mandate.currency.trim().toUpperCase();
    if (
      !['NOT SPECIFIED', 'UNSPECIFIED', 'ANY', 'N/A'].includes(thesisCurrency) &&
      thesisCurrency !== portfolio.baseCurrency.toUpperCase()
    ) {
      throw new Error(
        `${portfolio.name} uses ${portfolio.baseCurrency}, but the confirmed ${role.data} thesis mandate requires ${mandate.currency}`
      );
    }
    return [{
      id: portfolio.id,
      name: portfolio.name,
      role: role.data as Exclude<PortfolioRole, 'not_suitable'>,
      baseCurrency: portfolio.baseCurrency,
      investmentObjective: portfolio.investmentObjective ?? '',
    }];
  });
  if (!equityPortfolios.length) {
    throw new Error('Create a Swiss Quality or Brazilian Growth portfolio that is present in the confirmed thesis before stock discovery');
  }

  const provider = getPriceProvider();
  if (!provider.getSecurityUniverse || provider.name === 'stub' || provider.name === 'yahoo-search') {
    throw new Error('Live discovery requires MARKET_DATA_PROVIDER=eodhd and a valid MARKET_DATA_API_KEY; stub data is never used to recommend candidates');
  }
  const exchanges = [...new Set(equityPortfolios.map((portfolio) => ROLE_EXCHANGE[portfolio.role]!))];
  const batches = await Promise.all(exchanges.map((exchange) => provider.getSecurityUniverse!(exchange, 100)));
  const universe = uniqueBy(batches.flat(), (record) => `${record.exchange}:${record.ticker}`);
  if (!universe.length) throw new Error('The configured market-data provider returned an empty security universe');

  const request = DiscoveryRunRequest.parse({
    thesis: { versionId: thesis.id, criteria },
    portfolios: equityPortfolios,
    universe,
    maxCandidatesPerPortfolio,
    agentConfig,
  });
  return { request, provider: provider.name, thesisVersionId: thesis.id };
}

export async function synchronizeDiscoveryRun(
  localRunId: string,
  ownerId: string,
  remote: DiscoveryRunStatus
) {
  const [local] = await db.select().from(externalDiscoveryRuns).where(and(
    eq(externalDiscoveryRuns.id, localRunId),
    eq(externalDiscoveryRuns.ownerId, ownerId)
  )).limit(1);
  if (!local) throw new Error('Discovery run not found');
  if (local.externalDiscoveryId !== remote.externalDiscoveryId) throw new Error('Discovery identity changed');
  const [usableThesis] = await db.select({ id: thesisVersions.id }).from(thesisVersions).where(and(
    eq(thesisVersions.id, local.thesisVersionId),
    eq(thesisVersions.ownerId, ownerId),
    isNull(thesisVersions.excludedAt)
  )).limit(1);
  if (!usableThesis) {
    const [updated] = await db.update(externalDiscoveryRuns).set({
      status: 'failed',
      errorMessage: 'The associated thesis version was excluded',
      completedAt: new Date(),
    }).where(eq(externalDiscoveryRuns.id, local.id)).returning();
    return updated;
  }

  if (remote.status !== 'completed') {
    const [updated] = await db.update(externalDiscoveryRuns).set({
      status: remote.status,
      errorMessage: remote.errorMessage,
      completedAt: remote.status === 'failed' ? new Date() : local.completedAt,
    }).where(eq(externalDiscoveryRuns.id, local.id)).returning();
    return updated;
  }
  if (!remote.result) throw new Error('Completed discovery is missing its result');
  const request = DiscoveryRunRequest.parse(local.requestJson);
  const result = MarketDiscoveryOutput.parse(remote.result);
  validateDiscoveryOutput(result, request);

  return db.transaction(async (tx) => {
    const [updated] = await tx.update(externalDiscoveryRuns).set({
      status: 'completed',
      resultJson: result,
      errorMessage: null,
      completedAt: new Date(),
    }).where(eq(externalDiscoveryRuns.id, local.id)).returning();
    for (const candidate of result.candidates) {
      await tx.insert(discoveryCandidates).values({
        ownerId,
        runId: local.id,
        portfolioId: candidate.portfolioId,
        ticker: candidate.ticker,
        exchange: candidate.exchange,
        companyName: candidate.companyName,
        currency: candidate.currency,
        country: candidate.country,
        sector: candidate.sector,
        discoveryJson: candidate,
      }).onConflictDoNothing();
    }
    return updated;
  });
}

async function ownedCandidate(ownerId: string, candidateId: string) {
  const [row] = await db.select({
    candidate: discoveryCandidates,
    portfolio: portfolios,
    run: externalDiscoveryRuns,
  }).from(discoveryCandidates)
    .innerJoin(portfolios, eq(discoveryCandidates.portfolioId, portfolios.id))
    .innerJoin(externalDiscoveryRuns, eq(discoveryCandidates.runId, externalDiscoveryRuns.id))
    .innerJoin(thesisVersions, eq(externalDiscoveryRuns.thesisVersionId, thesisVersions.id))
    .where(and(
      eq(discoveryCandidates.id, candidateId),
      eq(discoveryCandidates.ownerId, ownerId),
      isNull(thesisVersions.excludedAt)
    ))
    .limit(1);
  return row ?? null;
}

export async function rejectOrWatchCandidate(
  ownerId: string,
  candidateId: string,
  decision: 'rejected' | 'watchlist',
  rationale: string | undefined
) {
  const row = await ownedCandidate(ownerId, candidateId);
  if (!row) throw new Error('Discovery candidate not found');
  if (row.candidate.decision === 'approved') throw new Error('An approved candidate cannot be downgraded while its analysis is active');
  const [updated] = await db.update(discoveryCandidates).set({
    decision,
    rationale,
    decidedAt: new Date(),
    workflowStatus: decision,
    updatedAt: new Date(),
  }).where(eq(discoveryCandidates.id, candidateId)).returning();
  return updated;
}

export async function approveCandidateAndStartAnalysis(ownerId: string, candidateId: string, decidedBy: string) {
  const row = await ownedCandidate(ownerId, candidateId);
  if (!row) throw new Error('Discovery candidate not found');
  if (row.candidate.externalAnalysisRunId) throw new Error('This candidate already has an analysis run');
  if (row.candidate.decision !== 'pending' && row.candidate.decision !== 'watchlist') {
    throw new Error('Only pending or watchlist candidates can be approved');
  }

  const provider = getPriceProvider();
  if (provider.name === 'stub') throw new Error('Candidate analysis refuses stub market data; configure EODHD first');
  if (!provider.getFundamentals) throw new Error('The configured provider does not supply fundamentals');
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 550 * 86_400_000).toISOString().slice(0, 10);
  const [bars, fundamentals] = await Promise.all([
    provider.getDailyBars(row.candidate.ticker, row.candidate.exchange, from, to),
    provider.getFundamentals(row.candidate.ticker, row.candidate.exchange),
  ]);
  if (bars.length < 31) throw new Error(`Provider supplied only ${bars.length} price observations; at least 31 are required for risk analysis`);

  const [security] = await db.insert(securities).values({
    ticker: row.candidate.ticker,
    companyName: row.candidate.companyName,
    exchange: row.candidate.exchange,
    currency: row.candidate.currency,
    sector: row.candidate.sector,
    country: row.candidate.country,
  }).onConflictDoUpdate({
    target: [securities.ticker, securities.exchange],
    set: {
      companyName: row.candidate.companyName,
      currency: row.candidate.currency,
      sector: row.candidate.sector,
      country: row.candidate.country,
    },
  }).returning();

  await db.insert(priceHistory).values(bars.map((bar) => ({
    securityId: security.id,
    priceDate: bar.date,
    close: String(bar.close),
    currency: bar.currency,
    source: provider.name,
  }))).onConflictDoNothing();
  await Promise.all([
    recordPriceObservation(security.id, bars.at(-1)!, provider.name),
    recordFundamentalObservations(security.id, fundamentals, provider.name),
  ]);

  const risk = computeStandaloneSecurityRisk(bars);
  const dataAsOf = new Date(risk[0].dataAsOf);
  await db.insert(securityRiskSnapshots).values({
    ownerId,
    candidateId,
    securityId: security.id,
    metricsJson: risk,
    provider: provider.name,
    dataAsOf,
  });

  const observations = await db.select().from(marketDataObservations).where(and(
    eq(marketDataObservations.securityId, security.id),
    eq(marketDataObservations.observationType, 'fundamental'),
    eq(marketDataObservations.status, 'OK')
  )).orderBy(desc(marketDataObservations.retrievedAt));
  const fundamentalGrounding: GroundingBundle['fundamentals'] = {};
  const seen = new Set<string>();
  for (const observation of observations) {
    if (seen.has(observation.metricName)) continue;
    seen.add(observation.metricName);
    fundamentalGrounding[`fundamental:${observation.metricName}:${observation.id}`] =
      observation.valueNumeric == null ? observation.valueText : Number(observation.valueNumeric);
  }
  const discoveryEvidence = DiscoveryCandidate.parse(row.candidate.discoveryJson);
  fundamentalGrounding[`discovery:rationale:${candidateId}`] = discoveryEvidence.rationale;
  fundamentalGrounding[`discovery:matched_criteria:${candidateId}`] = discoveryEvidence.matchedCriteria.join(' | ');
  fundamentalGrounding[`discovery:information_gaps:${candidateId}`] = discoveryEvidence.informationGaps.join(' | ') || 'None recorded';
  fundamentalGrounding[`discovery:source_urls:${candidateId}`] = discoveryEvidence.sourceUrls.join(' | ');
  const computedMetrics: GroundingBundle['computedMetrics'] = {};
  for (const metric of risk) computedMetrics[`securityRiskMetric:${metric.metricName}:${metric.computedAt}`] = metric.value;
  computedMetrics[`marketPrice:close:${bars.at(-1)!.date}`] = bars.at(-1)!.close;
  const bundle: GroundingBundle = {
    ticker: security.ticker,
    companyName: security.companyName,
    exchange: security.exchange,
    currency: security.currency,
    sector: security.sector,
    country: security.country,
    computedMetrics,
    fundamentals: fundamentalGrounding,
    dataAsOf: new Date(Math.max(dataAsOf.getTime(), Date.parse(`${bars.at(-1)!.date}T00:00:00.000Z`))).toISOString(),
  };
  if (Object.keys(bundle.fundamentals).length === 0) {
    throw new Error('No provider fundamentals were available; the financial analysis was not started');
  }

  const [thesisVersion] = await db.select().from(thesisVersions)
    .where(and(
      eq(thesisVersions.id, row.run.thesisVersionId),
      eq(thesisVersions.ownerId, ownerId),
      isNull(thesisVersions.excludedAt)
    )).limit(1);
  if (!thesisVersion) throw new Error('The candidate thesis version has been excluded');
  const thesis = ThesisCriteria.parse(thesisVersion.criteriaJson);
  const [securityConfig, synthesisConfig] = await Promise.all([
    getActiveAgentCustomization(ownerId, 'security_analysis'),
    getActiveAgentCustomization(ownerId, 'portfolio_synthesis'),
  ]);
  const request = AgenticRunRequest.parse({
    thesis: { versionId: row.run.thesisVersionId, criteria: thesis },
    securities: [{ ticker: security.ticker, exchange: security.exchange, portfolioId: row.portfolio.id }],
    portfolios: [{
      id: row.portfolio.id,
      name: row.portfolio.name,
      baseCurrency: row.portfolio.baseCurrency,
      investmentObjective: row.portfolio.investmentObjective ?? '',
    }],
    groundingBundles: [{ portfolioId: row.portfolio.id, bundle }],
    origin: { kind: 'discovery_candidate', candidateId },
    agentConfigs: [securityConfig, synthesisConfig],
  });
  validateRunRequestCoherence(request);
  const remote = await startExternalAgenticRun(request);
  const [run] = await db.insert(externalAgenticRuns).values({
    ownerId,
    externalRunId: remote.externalRunId,
    status: remote.status,
    thesisVersion: String(thesis.version),
    reportPdfUrl: remote.reportPdfUrl,
    errorMessage: remote.errorMessage,
    requestJson: request,
  }).returning();
  const [candidate] = await db.update(discoveryCandidates).set({
    securityId: security.id,
    decision: 'approved',
    rationale: `Approved by ${decidedBy}`,
    decidedAt: new Date(),
    workflowStatus: 'analysis_queued',
    externalAnalysisRunId: remote.externalRunId,
    updatedAt: new Date(),
  }).where(eq(discoveryCandidates.id, candidateId)).returning();
  return { candidate, run, remote, risk };
}

export async function candidateAnalysisIds(runIds: string[]) {
  if (!runIds.length) return new Map<string, string>();
  const rows = await db.select({
    externalRunId: externalAgenticRuns.externalRunId,
    analysisId: aiAnalyses.id,
  }).from(externalAgenticRuns)
    .innerJoin(aiAnalyses, eq(aiAnalyses.externalRunId, externalAgenticRuns.id))
    .where(inArray(externalAgenticRuns.externalRunId, runIds));
  return new Map(rows.map((row) => [row.externalRunId, row.analysisId]));
}
