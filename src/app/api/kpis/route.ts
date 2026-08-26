import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { riskMetrics } from '@/lib/db/schema';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const portfolioId = new URL(req.url).searchParams.get('portfolioId');
  const rows = portfolioId
    ? await db.select().from(riskMetrics).where(eq(riskMetrics.portfolioId, portfolioId)).orderBy(desc(riskMetrics.computedAt))
    : await db.select().from(riskMetrics).orderBy(desc(riskMetrics.computedAt));
  return NextResponse.json({ kpis: rows });
}
