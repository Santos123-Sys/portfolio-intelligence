import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { riskMetrics } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export const runtime = 'nodejs';

/**
 * Latest value for each metric name, with full methodology attached.
 * The UI renders `value`; the drill-down renders everything else.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const portfolioId = url.searchParams.get('portfolioId');
  if (!portfolioId) {
    return NextResponse.json(
      { error: 'portfolioId is required. Risk metrics are always portfolio-scoped (ADR-002).' },
      { status: 400 }
    );
  }

  const rows = await db
    .select()
    .from(riskMetrics)
    .where(eq(riskMetrics.portfolioId, portfolioId))
    .orderBy(desc(riskMetrics.computedAt));

  const latest = new Map<string, typeof rows[number]>();
  for (const r of rows) if (!latest.has(r.metricName)) latest.set(r.metricName, r);

  return NextResponse.json({ portfolioId, metrics: [...latest.values()] });
}
