import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { aiAnalyses, analysisJobs, securities } from '@/lib/db/schema';
import { candidateDecisions, candidateReanalysisRequests } from '@/lib/db/workflow-schema';
import { assertMutationAuthorized } from '@/lib/auth';

export const runtime = 'nodejs';

const decisionSchema = z.object({
  analysisId: z.string().uuid(),
  decision: z.enum(['accepted', 'rejected', 'watchlist', 'reanalysis_requested']),
  rationale: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  const candidates = await db
    .select({
      id: aiAnalyses.id,
      ticker: securities.ticker,
      companyName: securities.companyName,
      country: securities.country,
      sector: securities.sector,
      portfolioRole: aiAnalyses.portfolioRole,
      investmentScore: aiAnalyses.investmentScore,
      thesisAlignmentScore: aiAnalyses.thesisAlignmentScore,
      confidenceScore: aiAnalyses.confidenceScore,
      risks: aiAnalyses.keyRisks,
      thesisBreakers: aiAnalyses.thesisBreakers,
      analysisTimestamp: aiAnalyses.analysisTimestamp,
    })
    .from(aiAnalyses)
    .innerJoin(securities, eq(aiAnalyses.securityId, securities.id))
    .where(eq(aiAnalyses.portfolioCandidate, true))
    .orderBy(desc(aiAnalyses.investmentScore));
  return NextResponse.json({ candidates });
}

export async function POST(req: Request) {
  let auth;
  try {
    auth = assertMutationAuthorized(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }

  const parsed = decisionSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const [analysis] = await db.select().from(aiAnalyses).where(eq(aiAnalyses.id, parsed.data.analysisId)).limit(1);
  if (!analysis) return NextResponse.json({ error: 'AI analysis not found' }, { status: 404 });

  const [decision] = await db
    .insert(candidateDecisions)
    .values({
      analysisId: parsed.data.analysisId,
      decision: parsed.data.decision,
      rationale: parsed.data.rationale,
      decidedBy: auth.subject,
      metadata: { ...(parsed.data.metadata ?? {}), authMode: auth.mode },
    })
    .returning();

  let reanalysisJob = null;
  if (parsed.data.decision === 'reanalysis_requested') {
    const [job] = await db
      .insert(analysisJobs)
      .values({
        status: 'pending',
        jobType: 'thesis_recheck',
        securityId: analysis.securityId,
        thesisVersionId: analysis.thesisVersionId,
      })
      .returning();
    await db.insert(candidateReanalysisRequests).values({ decisionId: decision.id, analysisJobId: job.id });
    reanalysisJob = job;
  }

  return NextResponse.json({ decision, reanalysisJob }, { status: 201 });
}
