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
import { loadDiscoveryUniverse } from './discovery-provider';
import { db } from './db';
import { aiAnalyses, portfolios, priceHistory, securities, thesisVersions } from './db/schema';
import {
  discoveryCandidates,
  externalAgenticRuns,
  externalDiscoveryRuns,
  securityRiskSnapshots,
} from './db/workflow-schema';
import { startExternalAgenticRun, startExternalDiscoveryRun } from './integrations/agentic-client';
import { computeStandaloneSecurityRisk } from './quant/security-risk';
import { recordPriceObservation } from './services/provenance';

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
  maxCandidatesPerPortfolio = 8,
  thesisVersionId?: string
): Promise<{ request: DiscoveryRunRequest; provider: string; thesisVersionId: string }> {
  const thesisFilters = [
    eq(thesisVersions.ownerId, ownerId),
    isNull(thesisVersions.excludedAt),
  ];
  if (thesisVersionId) thesisFilters.push(eq(thesisVersions.id, thesisVersionId));
  const [thesis, ownerPortfolios, agentConfig] = await Promise.all([
    db.select().from(thesisVersions).where(and(...thesisFilters))
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

  const exchanges = [...new Set(equityPortfolios.map((portfolio) => ROLE_EXCHANGE[portfolio.role]!))];
  // At most 25 names per market: a 20–50-company structural universe is the
  // input to qualitative research, not the final recommendation list.
  const loaded = await Promise.all(exchanges.map((exchange) => loadDiscoveryUniverse(exchange, 25)));
  const batches = loaded.map((result) => result.records);
  const universe = uniqueBy(batches.flat(), (record) => `${record.exchange}:${record.ticker}`);
  if (!universe.length) throw new Error('The configured market-data provider returned an empty security universe');

  const request = DiscoveryRunRequest.parse({
    thesis: { versionId: thesis.id, criteria },
    portfolios: equityPortfolios,
    universe,
    maxCandidatesPerPortfolio,
    agentConfig,
  });
  return { request, provider: [...new Set(loaded.map((result) => `${result.provider}${result.cached ? ':cached' : ''}`))].join(', '), thesisVersionId: thesis.id };
}

export async function startDiscoveryRunForOwner(input: {
  ownerId: string;
  maxCandidatesPerPortfolio?: number;
  thesisVersionId?: string;
  reuseExistingForThesis?: boolean;
}) {
  if (input.reuseExistingForThesis && input.thesisVersionId) {
    const [existing] = await db.select().from(externalDiscoveryRuns).where(and(
      eq(externalDiscoveryRuns.ownerId, input.ownerId),
      eq(externalDiscoveryRuns.thesisVersionId, input.thesisVersionId)
    )).orderBy(desc(externalDiscoveryRuns.requestedAt)).limit(1);
    if (existing) return { run: existing, remote: null, reused: true as const };
  }

  const built = await buildDiscoveryRunRequest(
    input.ownerId,
    input.maxCandidatesPerPortfolio ?? 6,
    input.thesisVersionId
  );
  const remote = await startExternalDiscoveryRun(built.request);
  const [created] = await db.insert(externalDiscoveryRuns).values({
    ownerId: input.ownerId,
    thesisVersionId: built.thesisVersionId,
    externalDiscoveryId: remote.externalDiscoveryId,
    status: remote.status,
    provider: built.provider,
    requestJson: built.request,
    resultJson: remote.result,
    errorMessage: remote.errorMessage,
    completedAt: remote.status === 'completed' || remote.status === 'failed' ? new Date() : null,
  }).returning();
  const run = remote.status === 'completed'
    ? await synchronizeDiscoveryRun(created.id, input.ownerId, remote)
    : created;
  return { run, remote, reused: false as const };
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

/**
 * Persist the human decision before any market-data or agentic call. Approval
 * is a durable workflow transition; it must not disappear merely because an
 * external provider is slow or unavailable after the user clicks the button.
 * An approved candidate whose preparation failed can re-enter this state, but
 * a candidate with an external run must use the external-run retry path.
 */
export async function approveCandidateForAnalysis(ownerId: string, candidateId: string, decidedBy: string) {
  const row = await ownedCandidate(ownerId, candidateId);
  if (!row) throw new Error('Discovery candidate not found');
  if (row.candidate.externalAnalysisRunId) throw new Error('This candidate already has an analysis run; use Retry analysis if it failed');
  const retryingPreparation = row.candidate.decision === 'approved' && row.candidate.workflowStatus === 'analysis_failed';
  if (row.candidate.decision !== 'pending' && row.candidate.decision !== 'watchlist' && !retryingPreparation) {
    throw new Error('Only pending or watchlist candidates can be approved');
  }

  const [candidate] = await db.update(discoveryCandidates).set({
    decision: 'approved',
    rationale: `Approved by ${decidedBy}`,
    decidedAt: row.candidate.decidedAt ?? new Date(),
    workflowStatus: 'analysis_preparing',
    analysisErrorMessage: null,
    updatedAt: new Date(),
  }).where(and(
    eq(discoveryCandidates.id, candidateId),
    eq(discoveryCandidates.ownerId, ownerId),
    eq(discoveryCandidates.decision, row.candidate.decision),
    eq(discoveryCandidates.workflowStatus, row.candidate.workflowStatus),
    isNull(discoveryCandidates.externalAnalysisRunId)
  )).returning();
  if (!candidate) throw new Error('Candidate approval changed concurrently; refresh before trying again');
  return { candidate };
}

/** Complete the slow provider and agentic handoff after approval is visible. */
export async function startApprovedCandidateAnalysis(
  ownerId: string,
  candidateId: string
) {
  const row = await ownedCandidate(ownerId, candidateId);
  if (!row) throw new Error('Discovery candidate not found');
  if (row.candidate.externalAnalysisRunId) throw new Error('This candidate already has an analysis run');
  if (row.candidate.decision !== 'approved' || row.candidate.workflowStatus !== 'analysis_preparing') {
    throw new Error('Candidate analysis can start only from the analysis_preparing state');
  }

  const provider = getPriceProvider();
  if (provider.name === 'stub') throw new Error('Candidate analysis refuses stub market data; configure EODHD first');
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 550 * 86_400_000).toISOString().slice(0, 10);
  const bars = await provider.getDailyBars(row.candidate.ticker, row.candidate.exchange, from, to);
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
  await recordPriceObservation(security.id, bars.at(-1)!, provider.name);

  const risk = computeStandaloneSecurityRisk(bars);
  const dataAsOf = new Date(risk[0].dataAsOf);
  // Preparation can be retried after a provider or agentic-service failure.
  // Replace the deterministic snapshot instead of accumulating duplicates.
  await db.delete(securityRiskSnapshots).where(and(
    eq(securityRiskSnapshots.ownerId, ownerId),
    eq(securityRiskSnapshots.candidateId, candidateId)
  ));
  await db.insert(securityRiskSnapshots).values({
    ownerId,
    candidateId,
    securityId: security.id,
    metricsJson: risk,
    provider: provider.name,
    dataAsOf,
  });

  const discoveryEvidence = DiscoveryCandidate.parse(row.candidate.discoveryJson);
  const researchEvidence: NonNullable<GroundingBundle['researchEvidence']> = {
    [`research:rationale:${candidateId}`]: discoveryEvidence.rationale,
    [`research:matched_criteria:${candidateId}`]: discoveryEvidence.matchedCriteria.join(' | ') || 'None evidenced',
    [`research:violated_criteria:${candidateId}`]: discoveryEvidence.violatedCriteria.join(' | ') || 'None evidenced',
    [`research:information_gaps:${candidateId}`]: discoveryEvidence.informationGaps.join(' | ') || 'None recorded',
    [`research:source_urls:${candidateId}`]: discoveryEvidence.sourceUrls.join(' | '),
  };
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
    fundamentals: {},
    analysisMode: 'limited_research_risk',
    researchEvidence,
    dataAsOf: new Date(Math.max(dataAsOf.getTime(), Date.parse(`${bars.at(-1)!.date}T00:00:00.000Z`))).toISOString(),
  };

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
    workflowStatus: 'analysis_queued',
    externalAnalysisRunId: remote.externalRunId,
    analysisErrorMessage: null,
    updatedAt: new Date(),
  }).where(and(
    eq(discoveryCandidates.id, candidateId),
    eq(discoveryCandidates.ownerId, ownerId),
    eq(discoveryCandidates.workflowStatus, 'analysis_preparing'),
    isNull(discoveryCandidates.externalAnalysisRunId)
  )).returning();
  if (!candidate) throw new Error('Candidate analysis state changed before the run could be attached');
  return { candidate, run, remote, risk };
}

export async function failCandidateAnalysisPreparation(ownerId: string, candidateId: string, error: unknown) {
  const message = (error instanceof Error ? error.message : 'Unknown analysis preparation failure').slice(0, 2_000);
  const [candidate] = await db.update(discoveryCandidates).set({
    workflowStatus: 'analysis_failed',
    analysisErrorMessage: message,
    updatedAt: new Date(),
  }).where(and(
    eq(discoveryCandidates.id, candidateId),
    eq(discoveryCandidates.ownerId, ownerId),
    eq(discoveryCandidates.workflowStatus, 'analysis_preparing'),
    isNull(discoveryCandidates.externalAnalysisRunId)
  )).returning();
  return candidate ?? null;
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
