import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { aiAnalyses, securities, thesisVersions } from '@/lib/db/schema';
import { and, eq, desc, isNull } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Recent analyses, newest first — feeds the AI Intelligence Feed (Page 5) and
 * Security Detail (Page 4). Joined against securities so the feed can render
 * a ticker without a second round trip per row.
 */
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const url = new URL(req.url);
  const securityId = url.searchParams.get('securityId');

  const base = db
    .select({
      id: aiAnalyses.id,
      securityId: aiAnalyses.securityId,
      portfolioId: aiAnalyses.portfolioId,
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
      informationGaps: aiAnalyses.informationGaps,
      externalRunId: aiAnalyses.externalRunId,
      supersedesId: aiAnalyses.supersedesId,
      analysisTimestamp: aiAnalyses.analysisTimestamp,
      dataTimestamp: aiAnalyses.dataTimestamp,
    })
    .from(aiAnalyses)
    .innerJoin(securities, eq(aiAnalyses.securityId, securities.id))
    .innerJoin(thesisVersions, eq(aiAnalyses.thesisVersionId, thesisVersions.id));

  const rows = securityId
    ? await base.where(and(
        eq(aiAnalyses.ownerId, session.auth.userId),
        eq(aiAnalyses.securityId, securityId),
        isNull(thesisVersions.excludedAt)
      )).orderBy(desc(aiAnalyses.analysisTimestamp))
    : await base.where(and(
        eq(aiAnalyses.ownerId, session.auth.userId),
        isNull(thesisVersions.excludedAt)
      )).orderBy(desc(aiAnalyses.analysisTimestamp)).limit(50);

  return NextResponse.json({ analyses: rows });
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }
  return NextResponse.json(
    { error: 'Internal analysis jobs are retired. Start an external run through /api/integrations/agentic/runs.' },
    { status: 410 }
  );
}
