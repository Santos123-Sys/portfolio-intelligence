import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { aiAnalyses, decisionLog, securities } from '@/lib/db/schema';
import { candidateDecisions } from '@/lib/db/workflow-schema';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';

export const runtime = 'nodejs';

const decisionSchema = z.object({
  analysisId: z.string().uuid(),
  decision: z.enum(['accepted', 'rejected', 'watchlist', 'reanalysis_requested']),
  rationale: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const candidates = await db
    .select({
      id: aiAnalyses.id,
      portfolioId: aiAnalyses.portfolioId,
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
    .where(and(eq(aiAnalyses.ownerId, session.auth.userId), eq(aiAnalyses.portfolioCandidate, true)))
    .orderBy(desc(aiAnalyses.investmentScore));
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

  const [analysis] = await db.select().from(aiAnalyses)
    .where(and(eq(aiAnalyses.id, parsed.data.analysisId), eq(aiAnalyses.ownerId, session.auth.userId))).limit(1);
  if (!analysis) return NextResponse.json({ error: 'AI analysis not found' }, { status: 404 });

  const [security] = await db.select({ ticker: securities.ticker, companyName: securities.companyName })
    .from(securities).where(eq(securities.id, analysis.securityId)).limit(1);
  const [decision] = await db.transaction(async (tx) => {
    const created = await tx.insert(candidateDecisions).values({
      analysisId: parsed.data.analysisId,
      ownerId: session.auth.userId,
      decision: parsed.data.decision,
      rationale: parsed.data.rationale,
      decidedBy: session.auth.email,
      metadata: parsed.data.metadata,
    }).returning();
    await tx.insert(decisionLog).values({
      ownerId: session.auth.userId,
      title: `${security?.companyName ?? 'Candidate'} (${security?.ticker ?? 'unknown'}) — analyst ${parsed.data.decision}`,
      decision: parsed.data.decision,
      reasoning: parsed.data.rationale ?? null,
      outcome: parsed.data.decision === 'reanalysis_requested'
        ? 'Reanalysis requested; no investment action was taken.'
        : 'Human review verdict recorded; no investment action was taken.',
      relatedSecurityId: analysis.securityId,
      relatedPortfolioId: analysis.portfolioId,
      metadata: { analysisId: analysis.id, thesisVersionId: analysis.thesisVersionId, evidenceAsOf: analysis.dataTimestamp?.toISOString() },
    });
    return created;
  });

  return NextResponse.json({
    decision,
    externalRunRequired: parsed.data.decision === 'reanalysis_requested',
  }, { status: 201 });
}
