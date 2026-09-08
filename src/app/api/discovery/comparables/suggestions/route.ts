import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { suggestComparablePeers } from '@/lib/comparable-research';
import { db } from '@/lib/db';
import { discoveryCandidates } from '@/lib/db/workflow-schema';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';
const schema = z.object({ candidateId: z.string().uuid() }).strict();

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 2 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const [candidate] = await db.select().from(discoveryCandidates).where(and(
    eq(discoveryCandidates.id, parsed.data.candidateId), eq(discoveryCandidates.ownerId, session.auth.userId)
  )).limit(1);
  if (!candidate?.analysisId) return NextResponse.json({ error: 'Complete the approved security analysis before suggesting peers' }, { status: 409 });
  try {
    const result = await suggestComparablePeers({ companyName: candidate.companyName, ticker: candidate.ticker, exchange: candidate.exchange, currency: candidate.currency, sector: candidate.sector });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: `Peer discovery failed: ${(error as Error).message}` }, { status: 502 });
  }
}
