import { after, NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { aiAnalyses, portfolios, thesisVersions } from '@/lib/db/schema';
import {
  discoveryCandidates,
  externalAgenticRuns,
  externalDiscoveryRuns,
  securityRiskSnapshots,
  valuationScenarios,
} from '@/lib/db/workflow-schema';
import {
  approveCandidateForAnalysis,
  failCandidateAnalysisPreparation,
  rejectOrWatchCandidate,
  startApprovedCandidateAnalysis,
} from '@/lib/discovery-workflow';

export const runtime = 'nodejs';

const decisionSchema = z.object({
  candidateId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected', 'watchlist']),
  rationale: z.string().trim().max(2_000).optional(),
}).strict();

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
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
      isNull(thesisVersions.excludedAt)
    ))
    .orderBy(desc(discoveryCandidates.createdAt));
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

  const candidates = rows.map((row) => {
    const run = row.candidate.externalAnalysisRunId
      ? runByExternalId.get(row.candidate.externalAnalysisRunId)
      : null;
    const analysis = run ? analysisByRunId.get(run.id) : null;
    const risk = riskRows.find((snapshot) => snapshot.candidateId === row.candidate.id) ?? null;
    const valuation = valuationRows.find((scenario) => scenario.candidateId === row.candidate.id) ?? null;
    return {
      ...row.candidate,
      portfolioName: row.portfolioName,
      discoveryRequestedAt: row.discoveryRequestedAt,
      analysisRunStatus: run?.status ?? null,
      analysisRunError: run?.errorMessage ?? null,
      analysis: analysis ?? null,
      risk: risk?.metricsJson ?? null,
      valuation,
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
      const candidate = await approveCandidateForAnalysis(
        session.auth.userId,
        parsed.data.candidateId,
        session.auth.email
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
      return NextResponse.json({ candidate }, { status: 202 });
    }
    const candidate = await rejectOrWatchCandidate(
      session.auth.userId,
      parsed.data.candidateId,
      parsed.data.decision,
      parsed.data.rationale
    );
    return NextResponse.json({ candidate });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
