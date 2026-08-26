import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { analysisJobs, aiAnalyses, thesisVersions, securities } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export const runtime = 'nodejs';

/**
 * Recent analyses, newest first — feeds the AI Intelligence Feed (Page 5) and
 * Security Detail (Page 4). Joined against securities so the feed can render
 * a ticker without a second round trip per row.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const securityId = url.searchParams.get('securityId');

  const base = db
    .select({
      id: aiAnalyses.id,
      securityId: aiAnalyses.securityId,
      ticker: securities.ticker,
      companyName: securities.companyName,
      thesisVersionId: aiAnalyses.thesisVersionId,
      portfolioCandidate: aiAnalyses.portfolioCandidate,
      portfolioRole: aiAnalyses.portfolioRole,
      investmentScore: aiAnalyses.investmentScore,
      thesisAlignmentScore: aiAnalyses.thesisAlignmentScore,
      qualityScore: aiAnalyses.qualityScore,
      growthScore: aiAnalyses.growthScore,
      riskScore: aiAnalyses.riskScore,
      dividendScore: aiAnalyses.dividendScore,
      fundamentalSummary: aiAnalyses.fundamentalSummary,
      investmentThesis: aiAnalyses.investmentThesis,
      keyCatalysts: aiAnalyses.keyCatalysts,
      keyRisks: aiAnalyses.keyRisks,
      thesisBreakers: aiAnalyses.thesisBreakers,
      confidenceScore: aiAnalyses.confidenceScore,
      groundedIn: aiAnalyses.groundedIn,
      supersedesId: aiAnalyses.supersedesId,
      analysisTimestamp: aiAnalyses.analysisTimestamp,
      dataTimestamp: aiAnalyses.dataTimestamp,
    })
    .from(aiAnalyses)
    .innerJoin(securities, eq(aiAnalyses.securityId, securities.id));

  const rows = securityId
    ? await base.where(eq(aiAnalyses.securityId, securityId)).orderBy(desc(aiAnalyses.analysisTimestamp))
    : await base.orderBy(desc(aiAnalyses.analysisTimestamp)).limit(50);

  return NextResponse.json({ analyses: rows });
}

/**
 * Enqueue an analysis. Returns 202 immediately.
 *
 * ADR-009: an Agenteki run is minutes of LLM calls with unpredictable duration
 * and MUST NOT execute inside an HTTP request. This handler writes a job row;
 * the cron worker picks it up; the client polls GET /api/analysis.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { securityId, portfolioId, jobType = 'single_security' } = body as {
    securityId?: string; portfolioId?: string; jobType?: string;
  };

  if (jobType === 'single_security' && !securityId) {
    return NextResponse.json({ error: 'securityId required for single_security jobs' }, { status: 400 });
  }

  const [thesis] = await db
    .select({ id: thesisVersions.id })
    .from(thesisVersions)
    .orderBy(desc(thesisVersions.versionNumber))
    .limit(1);

  if (!thesis) {
    return NextResponse.json(
      { error: 'No thesis version exists. Agenteki cannot score against nothing — seed a thesis first.' },
      { status: 409 }
    );
  }

  const [job] = await db
    .insert(analysisJobs)
    .values({ status: 'pending', jobType, securityId, portfolioId, thesisVersionId: thesis.id })
    .returning();

  return NextResponse.json(
    { job, message: 'Queued. Poll GET /api/analysis or check job status.' },
    { status: 202 }
  );
}
