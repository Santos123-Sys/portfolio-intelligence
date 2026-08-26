import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { marketDataObservations } from '@/lib/db/workflow-schema';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const securityId = params.get('securityId');
  const limit = Math.min(Number(params.get('limit') ?? 100), 500);

  const base = db.select().from(marketDataObservations);
  const rows = securityId
    ? await base.where(eq(marketDataObservations.securityId, securityId)).orderBy(desc(marketDataObservations.retrievedAt)).limit(limit)
    : await base.orderBy(desc(marketDataObservations.retrievedAt)).limit(limit);

  return NextResponse.json({ observations: rows });
}
