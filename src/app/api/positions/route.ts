import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { positions, securities, aiAnalyses, priceHistory, portfolios } from '@/lib/db/schema';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { authenticateRequest, portfolioIsOwned } from '@/lib/api-auth';
import { assertSameOrigin } from '@/lib/auth';
import { holdingCreateSchema } from '@/lib/portfolio-setup';
import { readBoundedJson } from '@/lib/request-body';

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

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }

  const body = await readBoundedJson(req, 16 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = holdingCreateSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [portfolio] = await tx
        .select()
        .from(portfolios)
        .where(and(
          eq(portfolios.id, parsed.data.portfolioId),
          eq(portfolios.ownerId, session.auth.userId)
        ))
        .limit(1);
      if (!portfolio) throw new PositionSetupError('Portfolio not found', 404);

      let [security] = await tx
        .select()
        .from(securities)
        .where(and(
          eq(securities.ticker, parsed.data.ticker),
          eq(securities.exchange, parsed.data.exchange)
        ))
        .limit(1);

      if (!security) {
        [security] = await tx.insert(securities).values({
          ticker: parsed.data.ticker,
          companyName: parsed.data.companyName,
          exchange: parsed.data.exchange,
          currency: parsed.data.currency,
          sector: parsed.data.sector || null,
          country: parsed.data.country || null,
        }).onConflictDoNothing({
          target: [securities.ticker, securities.exchange],
        }).returning();
        if (!security) {
          [security] = await tx
            .select()
            .from(securities)
            .where(and(
              eq(securities.ticker, parsed.data.ticker),
              eq(securities.exchange, parsed.data.exchange)
            ))
            .limit(1);
        }
      }
      if (!security) throw new Error('Security creation did not return a record');

      const [duplicate] = await tx
        .select({ id: positions.id })
        .from(positions)
        .where(and(
          eq(positions.portfolioId, portfolio.id),
          eq(positions.securityId, security.id)
        ))
        .limit(1);
      if (duplicate) {
        throw new PositionSetupError('This security already has a position in the selected portfolio', 409);
      }

      const [position] = await tx.insert(positions).values({
        portfolioId: portfolio.id,
        securityId: security.id,
        quantity: String(parsed.data.quantity),
        avgCost: String(parsed.data.avgCost),
      }).returning();
      return { portfolio, security, position };
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof PositionSetupError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Unable to create position' }, { status: 500 });
  }
}

class PositionSetupError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message);
  }
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
