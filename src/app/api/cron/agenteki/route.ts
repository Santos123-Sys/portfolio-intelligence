import { NextResponse } from 'next/server';
import { assertCronAuthorized, getEnv } from '@/lib/env';
import { withLock } from '@/lib/services/lock';
import { db } from '@/lib/db';
import { analysisJobs, aiAnalyses, securities, thesisVersions, riskMetrics } from '@/lib/db/schema';
import { agentRuns, agentSteps } from '@/lib/db/agentic-schema';
import { eq, asc, desc } from 'drizzle-orm';
import { runAgenticAnalysis } from '@/lib/agenteki/agentic-runtime';
import { GroundingBundle, ThesisCriteria } from '@/lib/agenteki/schemas';
import { getPriceProvider } from '@/lib/connectors';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Seven model calls are made per security, so process one bounded job per invocation. */
const MAX_JOBS_PER_RUN = 1;
const ORCHESTRATOR_VERSION = 'agenteki-committee-1.0.0';

export async function GET(req: Request) {
  try {
    assertCronAuthorized(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }

  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set; Agenteki cannot run' }, { status: 503 });
  }

  const outcome = await withLock('agenteki_worker', async () => {
    const pending = await db.select().from(analysisJobs)
      .where(eq(analysisJobs.status, 'pending'))
      .orderBy(asc(analysisJobs.requestedAt)).limit(MAX_JOBS_PER_RUN);

    const results = [];
    for (const job of pending) {
      await db.update(analysisJobs)
        .set({ status: 'running', startedAt: new Date(), attempts: job.attempts + 1 })
        .where(eq(analysisJobs.id, job.id));

      let runId: string | null = null;
      try {
        if (!job.securityId) throw new Error('Job has no securityId');
        const [sec] = await db.select().from(securities).where(eq(securities.id, job.securityId));
        if (!sec) throw new Error(`Security ${job.securityId} not found`);

        const [thesisRow] = await db.select().from(thesisVersions)
          .where(eq(thesisVersions.id, job.thesisVersionId!));
        if (!thesisRow) throw new Error('Thesis version not found');

        const [run] = await db.insert(agentRuns).values({
          analysisJobId: job.id,
          securityId: sec.id,
          thesisVersionId: thesisRow.id,
          status: 'running',
          orchestratorVersion: ORCHESTRATOR_VERSION,
        }).returning();
        runId = run.id;

        // Only persisted deterministic values and connector evidence reach the agents.
        const computed: Record<string, number> = {};
        if (job.portfolioId) {
          const metrics = await db.select().from(riskMetrics)
            .where(eq(riskMetrics.portfolioId, job.portfolioId))
            .orderBy(desc(riskMetrics.computedAt)).limit(20);
          for (const m of metrics) if (!(m.metricName in computed)) computed[m.metricName] = m.value;
        }

        const provider = getPriceProvider();
        const fundamentals = provider.getFundamentals
          ? await provider.getFundamentals(sec.ticker, sec.exchange)
          : {};

        const bundle: GroundingBundle = {
          ticker: sec.ticker,
          companyName: sec.companyName,
          exchange: sec.exchange,
          currency: sec.currency,
          sector: sec.sector,
          country: sec.country,
          computedMetrics: computed,
          dataAsOf: new Date().toISOString(),
          fundamentals,
        };

        const thesis = ThesisCriteria.parse(thesisRow.criteriaJson);
        const trace = await runAgenticAnalysis({ thesis, bundle, apiKey: env.ANTHROPIC_API_KEY! });

        const stepEntries = [
          ['Thesis Interpreter', trace.thesis],
          ['Research Evidence Agent', trace.evidence],
          ['Fundamental Analyst', trace.fundamentals],
          ['Risk Interpreter', trace.risk],
          ['Portfolio Fit Agent', trace.portfolioFit],
          ['Critic Agent', trace.critic],
          ['Investment Committee Synthesizer', trace.committee],
        ] as const;
        await db.insert(agentSteps).values(stepEntries.map(([agentName, outputJson], i) => ({
          runId: run.id,
          sequence: i + 1,
          agentName,
          status: 'complete',
          outputJson,
        })));

        const out = trace.committee;
        const [prev] = await db.select({ id: aiAnalyses.id }).from(aiAnalyses)
          .where(eq(aiAnalyses.securityId, sec.id))
          .orderBy(desc(aiAnalyses.analysisTimestamp)).limit(1);

        await db.insert(aiAnalyses).values({
          securityId: sec.id,
          thesisVersionId: thesisRow.id,
          jobId: job.id,
          portfolioCandidate: out.portfolioCandidate,
          portfolioRole: out.portfolioRole,
          investmentScore: out.investmentScore,
          thesisAlignmentScore: out.thesisAlignmentScore,
          qualityScore: out.qualityScore,
          growthScore: out.growthScore,
          riskScore: out.riskScore,
          dividendScore: out.dividendScore,
          fundamentalSummary: out.fundamentalSummary,
          investmentThesis: out.investmentThesis,
          keyCatalysts: out.keyCatalysts,
          keyRisks: out.keyRisks,
          thesisBreakers: out.thesisBreakers,
          confidenceScore: out.confidenceScore,
          groundedIn: out.groundedIn,
          supersedesId: prev?.id ?? null,
          dataTimestamp: new Date(bundle.dataAsOf),
          agentVersion: `${env.AGENT_VERSION}/${ORCHESTRATOR_VERSION}`,
        });

        await db.update(agentRuns).set({ status: 'complete', completedAt: new Date() })
          .where(eq(agentRuns.id, run.id));
        await db.update(analysisJobs).set({ status: 'complete', completedAt: new Date() })
          .where(eq(analysisJobs.id, job.id));

        results.push({ jobId: job.id, runId: run.id, ticker: sec.ticker, status: 'complete' });
      } catch (e) {
        const message = (e as Error).message;
        if (runId) {
          await db.update(agentRuns).set({ status: 'failed', completedAt: new Date(), errorMessage: message })
            .where(eq(agentRuns.id, runId));
        }
        await db.update(analysisJobs)
          .set({ status: 'failed', completedAt: new Date(), errorMessage: message })
          .where(eq(analysisJobs.id, job.id));
        results.push({ jobId: job.id, runId, status: 'failed', error: message });
      }
    }
    return { processed: results.length, results };
  });

  if (!outcome.ran) return NextResponse.json({ skipped: true, reason: outcome.reason });
  return NextResponse.json({ ok: true, ...outcome.result });
}
