import { after, NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { DiscoveryCandidate } from '@portfolio-intelligence/agentic-contract';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getPriceProvider } from '@/lib/connectors';
import { loadDiscoveryLatestPrices } from '@/lib/discovery-market-data';
import { scoreDiscoveryEvidence } from '@/lib/discovery-evidence';
import { decisionJournalSchema } from '@/lib/decision-journal';
import { aiAnalyses, portfolios, thesisVersions } from '@/lib/db/schema';
import {
  discoveryCandidates,
  externalAgenticRuns,
  externalDiscoveryRuns,
  marketDataObservations,
  securityRiskSnapshots,
  valuationScenarios,
} from '@/lib/db/workflow-schema';
import {
  approveCandidateForAnalysis,
  failCandidateAnalysisPreparation,
  rejectOrWatchCandidate,
  startApprovedCandidateAnalysis,
} from '@/lib/discovery-workflow';
import {
  analysisModeFromRequest,
  isDcfLocked,
  LIMITED_DATA_DCF_LOCK_REASON,
  LIMITED_RESEARCH_RISK_MODE,
} from '@/lib/integrations/analysis-mode';

export const runtime = 'nodejs';

const decisionSchema = z.object({
  candidateId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected', 'watchlist']),
  journal: decisionJournalSchema.optional(),
}).strict();

const runIdSchema = z.string().uuid();

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const parsedRunId = runIdSchema.safeParse(new URL(req.url).searchParams.get('runId'));
  if (!parsedRunId.success) {
    return NextResponse.json({ error: 'A valid discovery runId is required' }, { status: 400 });
  }
  const rows = await db.select({
    candidate: discoveryCandidates,
    portfolioName: portfolios.name,
    discoveryRequestedAt: externalDiscoveryRuns.requestedAt,
  }).from(discoveryCandidates)
    .innerJoin(portfolios, eq(discoveryCandidates.portfolioId, portfolios.id))
    .innerJoin(externalDiscoveryRuns, eq(discoveryCandidates.runId, externalDiscoveryRuns.id))
    .innerJoin(thesisVersions, eq(externalDiscoveryRuns.thesisVersionId, thesisVersions.id))
    .where(and(
      eq(discoveryCandidates.ownerId, session.auth.userId),
      eq(discoveryCandidates.runId, parsedRunId.data),
      // Rejected ideas remain available in Research history for auditability,
      // but should not pollute the active human-review surface.
      ne(discoveryCandidates.decision, 'rejected'),
      isNull(thesisVersions.excludedAt)
    ))
    .orderBy(desc(discoveryCandidates.createdAt));
  let latestPrices = new Map();
  try {
    latestPrices = await loadDiscoveryLatestPrices(rows.map((row) => ({
      id: row.candidate.id,
      ticker: row.candidate.ticker,
      exchange: row.candidate.exchange,
    })), getPriceProvider());
  } catch {
    // Price enrichment is best-effort; the discovery shortlist remains usable
    // when a provider is not configured on a development environment.
  }
  const externalIds = rows.flatMap((row) => row.candidate.externalAnalysisRunId ? [row.candidate.externalAnalysisRunId] : []);
  const externalRuns = externalIds.length
    ? await db.select().from(externalAgenticRuns).where(and(
      eq(externalAgenticRuns.ownerId, session.auth.userId),
      inArray(externalAgenticRuns.externalRunId, externalIds)
    ))
    : [];
  const runByExternalId = new Map(externalRuns.map((run) => [run.externalRunId, run]));
  const runIds = externalRuns.map((run) => run.id);
  const analyses = runIds.length
    ? await db.select().from(aiAnalyses).where(and(
      eq(aiAnalyses.ownerId, session.auth.userId),
      inArray(aiAnalyses.externalRunId, runIds)
    ))
    : [];
  const analysisByRunId = new Map(analyses.map((analysis) => [analysis.externalRunId!, analysis]));
  const candidateIds = rows.map((row) => row.candidate.id);
  const securityIds = rows.flatMap((row) => row.candidate.securityId ? [row.candidate.securityId] : []);
  const [riskRows, valuationRows] = candidateIds.length ? await Promise.all([
    db.select().from(securityRiskSnapshots).where(and(
      eq(securityRiskSnapshots.ownerId, session.auth.userId),
      inArray(securityRiskSnapshots.candidateId, candidateIds)
    )).orderBy(desc(securityRiskSnapshots.computedAt)),
    db.select().from(valuationScenarios).where(and(
      eq(valuationScenarios.ownerId, session.auth.userId),
      inArray(valuationScenarios.candidateId, candidateIds)
    )).orderBy(desc(valuationScenarios.createdAt)),
  ]) : [[], []];
  const primarySourceRows = securityIds.length ? await db.select({
    securityId: marketDataObservations.securityId,
    metricName: marketDataObservations.metricName,
  }).from(marketDataObservations).where(and(
    inArray(marketDataObservations.securityId, securityIds),
    eq(marketDataObservations.observationType, 'fundamental'),
    eq(marketDataObservations.status, 'OK'),
    eq(marketDataObservations.provider, 'investor-relations')
  )) : [];
  const primaryMetricsBySecurity = new Map<string, Set<string>>();
  for (const row of primarySourceRows) {
    const metrics = primaryMetricsBySecurity.get(row.securityId) ?? new Set<string>();
    metrics.add(row.metricName);
    primaryMetricsBySecurity.set(row.securityId, metrics);
  }

  const candidates = rows.map((row) => {
    const run = row.candidate.externalAnalysisRunId
      ? runByExternalId.get(row.candidate.externalAnalysisRunId)
      : null;
    const analysis = run ? analysisByRunId.get(run.id) : null;
    const risk = riskRows.find((snapshot) => snapshot.candidateId === row.candidate.id) ?? null;
    const valuation = valuationRows.find((scenario) => scenario.candidateId === row.candidate.id) ?? null;
    const analysisMode = run
      ? analysisModeFromRequest(run.requestJson, row.candidate.ticker, row.candidate.exchange)
      : row.candidate.decision === 'approved'
        ? LIMITED_RESEARCH_RISK_MODE
        : null;
    const primaryDcfReady = row.candidate.securityId != null && ['free_cash_flow', 'total_debt', 'cash_and_equivalents', 'shares_outstanding']
      .every((metric) => primaryMetricsBySecurity.get(row.candidate.securityId!)?.has(metric));
    const dcfLocked = isDcfLocked(analysisMode) && !primaryDcfReady;
    const latestPrice = latestPrices.get(row.candidate.id) ?? null;
    const discovery = DiscoveryCandidate.parse(row.candidate.discoveryJson);
    return {
      ...row.candidate,
      latestPrice,
      evidenceScorecard: scoreDiscoveryEvidence(discovery, latestPrice),
      portfolioName: row.portfolioName,
      discoveryRequestedAt: row.discoveryRequestedAt,
      analysisRunStatus: run?.status ?? null,
      analysisRunError: run?.errorMessage ?? null,
      reportUrl: run && (run.reportPdfUrl || run.status === 'completed' || run.status === 'imported')
        ? `/api/integrations/agentic/reports?externalRunId=${encodeURIComponent(run.externalRunId)}`
        : null,
      analysis: analysis ?? null,
      risk: risk?.metricsJson ?? null,
      valuation,
      analysisMode,
      dcfLocked,
      dcfLockReason: dcfLocked ? LIMITED_DATA_DCF_LOCK_REASON : null,
    };
  });
  return NextResponse.json({ candidates });
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }
  const parsed = decisionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    if (parsed.data.decision === 'approved') {
      if (!parsed.data.journal) {
        return NextResponse.json({ error: 'Complete the decision journal before approving a candidate for analysis' }, { status: 400 });
      }
      const approval = await approveCandidateForAnalysis(
        session.auth.userId,
        parsed.data.candidateId,
        session.auth.email,
        parsed.data.journal
      );
      after(async () => {
        try {
          await startApprovedCandidateAnalysis(session.auth.userId, parsed.data.candidateId);
        } catch (error) {
          console.error('[candidate-analysis] Preparation failed', {
            candidateId: parsed.data.candidateId,
            ownerId: session.auth.userId,
            error: error instanceof Error ? error.message : 'Unknown failure',
          });
          try {
            await failCandidateAnalysisPreparation(session.auth.userId, parsed.data.candidateId, error);
          } catch (stateError) {
            console.error('[candidate-analysis] Could not persist preparation failure', {
              candidateId: parsed.data.candidateId,
              error: stateError instanceof Error ? stateError.message : 'Unknown state failure',
            });
          }
        }
      });
      return NextResponse.json({ candidate: approval.candidate }, { status: 202 });
    }
    const candidate = await rejectOrWatchCandidate(
      session.auth.userId,
      parsed.data.candidateId,
      parsed.data.decision,
      parsed.data.journal
    );
    return NextResponse.json({ candidate });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
