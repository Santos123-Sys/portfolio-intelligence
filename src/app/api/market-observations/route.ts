import { NextResponse } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { marketDataObservations } from '@/lib/db/workflow-schema';
import { authenticateRequest, ownedSecurityIds } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const params = new URL(req.url).searchParams;
  const securityId = params.get('securityId');
  const limit = Math.min(Number(params.get('limit') ?? 100), 500);
  const allowedSecurityIds = await ownedSecurityIds(session.auth.userId);
  if (securityId && !allowedSecurityIds.includes(securityId)) {
    return NextResponse.json({ error: 'Security not found' }, { status: 404 });
  }
  if (allowedSecurityIds.length === 0) return NextResponse.json({ observations: [] });

  const base = db.select().from(marketDataObservations);
  const rows = securityId
    ? await base.where(eq(marketDataObservations.securityId, securityId)).orderBy(desc(marketDataObservations.retrievedAt)).limit(limit)
    : await base.where(inArray(marketDataObservations.securityId, allowedSecurityIds))
        .orderBy(desc(marketDataObservations.retrievedAt)).limit(limit);

  return NextResponse.json({ observations: rows });
}
