import { NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { discoveryCandidates, externalDiscoveryRuns } from '@/lib/db/workflow-schema';
import { buildDiscoveryRunRequest, synchronizeDiscoveryRun } from '@/lib/discovery-workflow';
import {
  fetchExternalDiscoveryRun,
  retryExternalDiscoveryRun,
  startExternalDiscoveryRun,
} from '@/lib/integrations/agentic-client';

export const runtime = 'nodejs';

const startSchema = z.object({
  maxCandidatesPerPortfolio: z.number().int().min(1).max(20).default(8),
}).strict();

async function list(ownerId: string) {
  const runs = await db.select().from(externalDiscoveryRuns)
    .where(eq(externalDiscoveryRuns.ownerId, ownerId))
    .orderBy(desc(externalDiscoveryRuns.requestedAt))
    .limit(20);
  const ids = runs.map((run) => run.id);
  const candidates = ids.length
    ? await db.select({ runId: discoveryCandidates.runId }).from(discoveryCandidates)
      .where(inArray(discoveryCandidates.runId, ids))
    : [];
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.runId, (counts.get(candidate.runId) ?? 0) + 1);
  return runs.map((run) => ({ ...run, candidateCount: counts.get(run.id) ?? 0 }));
}

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const id = new URL(req.url).searchParams.get('id');
  let runs = await list(session.auth.userId);
  const active = runs.filter((run) =>
    (!id || run.id === id) && (run.status === 'queued' || run.status === 'running')
  );
  await Promise.all(active.map(async (run) => {
    try {
      const remote = await fetchExternalDiscoveryRun(run.externalDiscoveryId);
      await synchronizeDiscoveryRun(run.id, session.auth.userId, remote);
    } catch {
      // Keep the durable local record while the private service is temporarily unavailable.
    }
  }));
  if (active.length) runs = await list(session.auth.userId);
  if (id && !runs.some((run) => run.id === id)) {
    return NextResponse.json({ error: 'Discovery run not found' }, { status: 404 });
  }
  return NextResponse.json({ runs: id ? runs.filter((run) => run.id === id) : runs });
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }
  const parsed = startSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const built = await buildDiscoveryRunRequest(session.auth.userId, parsed.data.maxCandidatesPerPortfolio);
    const remote = await startExternalDiscoveryRun(built.request);
    const [run] = await db.insert(externalDiscoveryRuns).values({
      ownerId: session.auth.userId,
      thesisVersionId: built.thesisVersionId,
      externalDiscoveryId: remote.externalDiscoveryId,
      status: remote.status,
      provider: built.provider,
      requestJson: built.request,
      resultJson: remote.result,
      errorMessage: remote.errorMessage,
      completedAt: remote.status === 'completed' || remote.status === 'failed' ? new Date() : null,
    }).returning();
    if (remote.status === 'completed') await synchronizeDiscoveryRun(run.id, session.auth.userId, remote);
    return NextResponse.json({ run, remote }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function PATCH(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const [run] = await db.select().from(externalDiscoveryRuns).where(and(
    eq(externalDiscoveryRuns.id, id),
    eq(externalDiscoveryRuns.ownerId, session.auth.userId)
  )).limit(1);
  if (!run) return NextResponse.json({ error: 'Discovery run not found' }, { status: 404 });
  if (run.status !== 'failed') return NextResponse.json({ error: 'Only failed discovery runs can be retried' }, { status: 409 });
  try {
    const remote = await retryExternalDiscoveryRun(run.externalDiscoveryId);
    const [updated] = await db.update(externalDiscoveryRuns).set({
      status: remote.status,
      errorMessage: null,
      completedAt: null,
    }).where(eq(externalDiscoveryRuns.id, run.id)).returning();
    return NextResponse.json({ run: updated, remote }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
