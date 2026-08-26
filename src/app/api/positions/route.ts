import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { positions, securities, aiAnalyses } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const portfolioId = url.searchParams.get('portfolioId');

  const base = db
    .select({
      id: positions.id,
      portfolioId: positions.portfolioId,
      ticker: securities.ticker,
      companyName: securities.companyName,
      exchange: securities.exchange,
      currency: securities.currency,
      sector: securities.sector,
      country: securities.country,
      quantity: positions.quantity,
      avgCost: positions.avgCost,
      marketValueNative: positions.marketValueNative,
      weight: positions.weight,
      lastPricedAt: positions.lastPricedAt,
      aiScore: aiAnalyses.investmentScore,
      thesisAlignment: aiAnalyses.thesisAlignmentScore,
      analysisAt: aiAnalyses.analysisTimestamp,
    })
    .from(positions)
    .innerJoin(securities, eq(positions.securityId, securities.id))
    .leftJoin(aiAnalyses, eq(aiAnalyses.securityId, securities.id));

  const rows = portfolioId
    ? await base.where(eq(positions.portfolioId, portfolioId)).orderBy(desc(positions.weight))
    : await base.orderBy(desc(positions.weight));

  return NextResponse.json({ positions: rows });
}
