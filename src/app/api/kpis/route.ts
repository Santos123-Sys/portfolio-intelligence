import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { portfolios, riskMetrics } from '@/lib/db/schema';
import { authenticateRequest, portfolioIsOwned } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const portfolioId = new URL(req.url).searchParams.get('portfolioId');
  if (portfolioId && !(await portfolioIsOwned(session.auth.userId, portfolioId))) {
    return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
  }
  const rows = portfolioId
    ? await db.select().from(riskMetrics).where(eq(riskMetrics.portfolioId, portfolioId)).orderBy(desc(riskMetrics.computedAt))
    : await db.select({
        id: riskMetrics.id,
        portfolioId: riskMetrics.portfolioId,
        metricName: riskMetrics.metricName,
        value: riskMetrics.value,
        currency: riskMetrics.currency,
        methodology: riskMetrics.methodology,
        confidenceLevel: riskMetrics.confidenceLevel,
        horizonDays: riskMetrics.horizonDays,
        lookbackDays: riskMetrics.lookbackDays,
        annualizationFactor: riskMetrics.annualizationFactor,
        caveat: riskMetrics.caveat,
        computedAt: riskMetrics.computedAt,
        dataAsOf: riskMetrics.dataAsOf,
      }).from(riskMetrics)
        .innerJoin(portfolios, eq(riskMetrics.portfolioId, portfolios.id))
        .where(eq(portfolios.ownerId, session.auth.userId))
        .orderBy(desc(riskMetrics.computedAt));
  return NextResponse.json({ kpis: rows });
}
