import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { researchComparablePeer } from '@/lib/comparable-research';
import { db } from '@/lib/db';
import { discoveryCandidates } from '@/lib/db/workflow-schema';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';

const peerSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  ticker: z.string().trim().min(1).max(30),
  exchange: z.string().trim().min(2).max(12),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
}).strict();
const schema = z.object({ candidateId: z.string().uuid(), peers: z.array(peerSchema).min(6).max(10) }).strict();

/** Researches user-selected peer identities. It never certifies that a peer is comparable. */
export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try { assertSameOrigin(req); } catch { return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 }); }
  const body = await readBoundedJson(req, 16 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const [candidate] = await db.select({ id: discoveryCandidates.id, analysisId: discoveryCandidates.analysisId }).from(discoveryCandidates).where(and(
    eq(discoveryCandidates.id, parsed.data.candidateId), eq(discoveryCandidates.ownerId, session.auth.userId)
  )).limit(1);
  if (!candidate?.analysisId) return NextResponse.json({ error: 'Complete the approved security analysis before researching peers' }, { status: 409 });
  const peers = await Promise.all(parsed.data.peers.map((peer) => researchComparablePeer(peer)));
  return NextResponse.json({ peers });
}
