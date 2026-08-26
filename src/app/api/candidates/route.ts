import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { aiAnalyses, securities } from '@/lib/db/schema';

export const runtime = 'nodejs';

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
