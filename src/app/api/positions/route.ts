import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { positions, securities, aiAnalyses, priceHistory, portfolios } from '@/lib/db/schema';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { authenticateRequest, portfolioIsOwned } from '@/lib/api-auth';

export const runtime = 'nodejs';

/**
 * Positions, joined with portfolio identity, security identity, and the most
 * recent AI analysis (if one exists) — enough for the Positions table (Page 3)
 * and the ?ticker= lookup Security Detail (Page 4) needs, in one round trip.
 *
 * Day Δ is computed here, not by the quant engine: it is a two-point display
 * figure for the table, not a risk metric with methodology attached. Nothing
 * downstream reads it as a computed metric.
 */
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const url = new URL(req.url);
  const portfolioId = url.searchParams.get('portfolioId');
  const ticker = url.searchParams.get('ticker');

  const base = db
    .select({
      id: positions.id,
      portfolioId: positions.portfolioId,
      portfolioName: portfolios.name,
      securityId: positions.securityId,
      ticker: securities.ticker,
      companyName: securities.companyName,
      exchange: securities.exchange,
      currency: securities.currency,
      sector: securities.sector,
      country: securities.country,
      isin: securities.isin,
      quantity: positions.quantity,
      avgCost: positions.avgCost,
      marketValueNative: positions.marketValueNative,
      weight: positions.weight,
      lastPricedAt: positions.lastPricedAt,
      aiScore: aiAnalyses.investmentScore,
      thesisAlignment: aiAnalyses.thesisAlignmentScore,
      riskScore: aiAnalyses.riskScore,
      thesisBreakers: aiAnalyses.thesisBreakers,
      analysisAt: aiAnalyses.analysisTimestamp,
    })
    .from(positions)
    .innerJoin(securities, eq(positions.securityId, securities.id))
    .innerJoin(portfolios, eq(positions.portfolioId, portfolios.id))
    .leftJoin(aiAnalyses, and(
      eq(aiAnalyses.ownerId, portfolios.ownerId),
      eq(aiAnalyses.portfolioId, positions.portfolioId),
      eq(aiAnalyses.securityId, securities.id)
    ));

  if (portfolioId && !(await portfolioIsOwned(session.auth.userId, portfolioId))) {
    return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
  }

  let rows = portfolioId
    ? await base.where(and(eq(portfolios.ownerId, session.auth.userId), eq(positions.portfolioId, portfolioId))).orderBy(desc(positions.weight))
    : await base.where(eq(portfolios.ownerId, session.auth.userId)).orderBy(desc(positions.weight));

  if (ticker) {
    rows = rows.filter((r) => r.ticker.toLowerCase() === ticker.toLowerCase());
  }

  // De-duplicate to one row per position: the left join against aiAnalyses can
  // fan out if a security has more than one analysis row, so keep only the
  // most recent (rows already arrive newest-first per security via the join,
  // but Postgres doesn't guarantee join order — sort defensively).
  const byPositionId = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const existing = byPositionId.get(r.id);
    if (!existing || (r.analysisAt && (!existing.analysisAt || r.analysisAt > existing.analysisAt))) {
      byPositionId.set(r.id, r);
    }
  }
  const deduped = [...byPositionId.values()];

  const securityIds = [...new Set(deduped.map((r) => r.securityId))];
  const dayChangeBySecurity = await computeDayChanges(securityIds);

  const withDayChange = deduped.map((r) => ({
    ...r,
    dayChangePct: dayChangeBySecurity.get(r.securityId) ?? null,
  }));

  return NextResponse.json({ positions: withDayChange });
}

/** Latest close vs. prior close, per security, from price_history. */
async function computeDayChanges(securityIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (securityIds.length === 0) return result;

  const rows = await db
    .select({
      securityId: priceHistory.securityId,
      priceDate: priceHistory.priceDate,
      close: priceHistory.close,
    })
    .from(priceHistory)
    .where(inArray(priceHistory.securityId, securityIds))
    .orderBy(desc(priceHistory.priceDate));

  const bySecurity = new Map<string, { priceDate: string; close: string }[]>();
  for (const r of rows) {
    const list = bySecurity.get(r.securityId) ?? [];
    if (list.length < 2) list.push(r);
    bySecurity.set(r.securityId, list);
  }

  for (const [securityId, [latest, prior]] of bySecurity) {
    if (latest && prior) {
      const latestClose = Number(latest.close);
      const priorClose = Number(prior.close);
      if (priorClose !== 0) {
        result.set(securityId, (latestClose - priorClose) / priorClose);
      }
    }
  }
  return result;
}
