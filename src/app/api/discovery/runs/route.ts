import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { thesisVersions } from '@/lib/db/schema';
import { discoveryCandidates, externalDiscoveryRuns } from '@/lib/db/workflow-schema';
import { startDiscoveryRunForOwner, synchronizeDiscoveryRun } from '@/lib/discovery-workflow';
import {
  fetchExternalDiscoveryRun,
  retryExternalDiscoveryRun,
} from '@/lib/integrations/agentic-client';

export const runtime = 'nodejs';

const startSchema = z.object({
  maxCandidatesPerPortfolio: z.number().int().min(1).max(7).default(6),
}).strict();

async function list(ownerId: string) {
  const rows = await db.select({ run: externalDiscoveryRuns }).from(externalDiscoveryRuns)
    .innerJoin(thesisVersions, eq(externalDiscoveryRuns.thesisVersionId, thesisVersions.id))
    .where(and(
      eq(externalDiscoveryRuns.ownerId, ownerId),
      isNull(thesisVersions.excludedAt)
    ))
    .orderBy(desc(externalDiscoveryRuns.requestedAt))
    .limit(20);
  const runs = rows.map(({ run }) => run);
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
    const started = await startDiscoveryRunForOwner({
      ownerId: session.auth.userId,
      maxCandidatesPerPortfolio: parsed.data.maxCandidatesPerPortfolio,
    });
    return NextResponse.json({ run: started.run, remote: started.remote }, { status: 202 });
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
  const [row] = await db.select({ run: externalDiscoveryRuns }).from(externalDiscoveryRuns)
    .innerJoin(thesisVersions, eq(externalDiscoveryRuns.thesisVersionId, thesisVersions.id))
    .where(and(
      eq(externalDiscoveryRuns.id, id),
      eq(externalDiscoveryRuns.ownerId, session.auth.userId),
      isNull(thesisVersions.excludedAt)
    )).limit(1);
  const run = row?.run;
  if (!run) return NextResponse.json({ error: 'Discovery run not found or its thesis was excluded' }, { status: 404 });
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
