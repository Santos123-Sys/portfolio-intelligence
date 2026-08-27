import { NextResponse } from 'next/server';
import { and, desc, ilike, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { decisionLog, securities, portfolios } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/api-auth';

export const runtime = 'nodejs';

/**
 * Decision Log — append-only reference (Page 7). Nothing here ever mutates or
 * deletes a row; this route only ever SELECTs.
 *
 * `q` performs a simple full-text-ish search across title and reasoning, done
 * in Postgres rather than the client so the 50-row cap in the default query
 * doesn't hide older matches from a search.
 */
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim();

  const base = db
    .select({
      id: decisionLog.id,
      decisionDate: decisionLog.decisionDate,
      title: decisionLog.title,
      decision: decisionLog.decision,
      reasoning: decisionLog.reasoning,
      alternativesConsidered: decisionLog.alternativesConsidered,
      outcome: decisionLog.outcome,
      relatedSecurityTicker: securities.ticker,
      relatedPortfolioName: portfolios.name,
    })
    .from(decisionLog)
    .leftJoin(securities, eq(decisionLog.relatedSecurityId, securities.id))
    .leftJoin(portfolios, eq(decisionLog.relatedPortfolioId, portfolios.id));

  const rows = q
    ? await base
        .where(and(eq(decisionLog.ownerId, session.auth.userId), or(ilike(decisionLog.title, `%${q}%`), ilike(decisionLog.reasoning, `%${q}%`))))
        .orderBy(desc(decisionLog.decisionDate))
        .limit(50)
    : await base.where(eq(decisionLog.ownerId, session.auth.userId)).orderBy(desc(decisionLog.decisionDate)).limit(50);

  return NextResponse.json({ decisions: rows });
}
