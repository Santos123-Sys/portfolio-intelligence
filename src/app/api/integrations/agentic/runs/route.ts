import { NextResponse } from 'next/server';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { externalAgenticRuns } from '@/lib/db/workflow-schema';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { AgenticRunSelection } from '@/lib/integrations/agentic-contract';
import {
  fetchExternalAgenticRun,
  retryExternalAgenticJob,
  startExternalAgenticRun,
} from '@/lib/integrations/agentic-client';
import { buildAgenticRunRequest, getAgenticReadiness } from '@/lib/integrations/grounding-builder';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const externalRunId = new URL(req.url).searchParams.get('externalRunId');

  if (externalRunId) {
    const [local] = await db
      .select()
      .from(externalAgenticRuns)
      .where(and(
        eq(externalAgenticRuns.externalRunId, externalRunId),
        eq(externalAgenticRuns.ownerId, session.auth.userId)
      ))
      .limit(1);

    if (!local) return NextResponse.json({ error: 'External run not found' }, { status: 404 });

    try {
      const remote = await fetchExternalAgenticRun(externalRunId);
      const [updated] = await db
        .update(externalAgenticRuns)
        .set({
          status: local.status === 'imported' ? 'imported' : remote.status,
          errorMessage: remote.errorMessage,
          completedAt: remote.status === 'completed' || remote.status === 'failed' ? new Date() : local.completedAt,
          reportPdfUrl: remote.reportPdfUrl ?? local.reportPdfUrl,
        })
        .where(eq(externalAgenticRuns.id, local.id))
        .returning();
      return NextResponse.json({ run: updated, remote });
    } catch (e) {
      return NextResponse.json({ run: local, remoteError: (e as Error).message });
    }
  }

  const listRuns = () => db.select({
      id: externalAgenticRuns.id,
      externalRunId: externalAgenticRuns.externalRunId,
      status: externalAgenticRuns.status,
      thesisVersion: externalAgenticRuns.thesisVersion,
      requestedAt: externalAgenticRuns.requestedAt,
      completedAt: externalAgenticRuns.completedAt,
      importedAt: externalAgenticRuns.importedAt,
      reportPdfUrl: externalAgenticRuns.reportPdfUrl,
      errorMessage: externalAgenticRuns.errorMessage,
    })
    .from(externalAgenticRuns)
    .where(eq(externalAgenticRuns.ownerId, session.auth.userId))
    .orderBy(desc(externalAgenticRuns.requestedAt))
    .limit(50);

  const [initialRuns, readiness] = await Promise.all([
    listRuns(),
    getAgenticReadiness(session.auth.userId),
  ]);
  let runs = initialRuns;
  const active = runs.filter((run) => run.status === 'queued' || run.status === 'running');
  if (active.length) {
    await Promise.all(active.map(async (run) => {
      try {
        const remote = await fetchExternalAgenticRun(run.externalRunId);
        await db.update(externalAgenticRuns).set({
          status: remote.status,
          errorMessage: remote.errorMessage,
          reportPdfUrl: remote.reportPdfUrl ?? run.reportPdfUrl,
          completedAt: remote.status === 'completed' || remote.status === 'failed' ? new Date() : run.completedAt,
        }).where(and(
          eq(externalAgenticRuns.id, run.id),
          ne(externalAgenticRuns.status, 'imported')
        ));
      } catch {
        // The durable local row remains authoritative while the private service is temporarily unavailable.
      }
    }));
    runs = await listRuns();
  }

  return NextResponse.json({
    runs: runs.map((run) => ({
      externalRunId: run.externalRunId,
      status: run.status,
      thesisVersion: run.thesisVersion,
      requestedAt: run.requestedAt,
      completedAt: run.completedAt,
      importedAt: run.importedAt,
      errorMessage: run.errorMessage,
      reportUrl: run.reportPdfUrl || run.status === 'completed' || run.status === 'imported'
        ? `/api/integrations/agentic/reports?externalRunId=${encodeURIComponent(run.externalRunId)}`
        : null,
    })),
    readiness,
  });
}

export async function PATCH(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }
  const externalRunId = new URL(req.url).searchParams.get('externalRunId');
  if (!externalRunId) return NextResponse.json({ error: 'externalRunId is required' }, { status: 400 });
  const [run] = await db.select().from(externalAgenticRuns).where(and(
    eq(externalAgenticRuns.externalRunId, externalRunId),
    eq(externalAgenticRuns.ownerId, session.auth.userId)
  )).limit(1);
  if (!run) return NextResponse.json({ error: 'External run not found' }, { status: 404 });
  if (run.status !== 'failed') {
    return NextResponse.json({ error: 'Only failed runs can be retried' }, { status: 409 });
  }
  try {
    const remote = await retryExternalAgenticJob('analysis-runs', externalRunId);
    const [updated] = await db.update(externalAgenticRuns).set({
      status: remote.status,
      errorMessage: null,
      completedAt: null,
    }).where(eq(externalAgenticRuns.id, run.id)).returning();
    return NextResponse.json({ run: updated, remote }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }

  const parsed = AgenticRunSelection.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const canonicalRequest = await buildAgenticRunRequest(session.auth.userId, parsed.data);
    const remote = await startExternalAgenticRun(canonicalRequest);
    const [run] = await db
      .insert(externalAgenticRuns)
      .values({
        ownerId: session.auth.userId,
        externalRunId: remote.externalRunId,
        status: remote.status,
        thesisVersion: String(canonicalRequest.thesis.criteria.version),
        reportPdfUrl: remote.reportPdfUrl,
        errorMessage: remote.errorMessage,
        requestJson: canonicalRequest,
      })
      .onConflictDoNothing({ target: externalAgenticRuns.externalRunId })
      .returning();

    if (!run) {
      return NextResponse.json({ error: 'External run ID collision' }, { status: 409 });
    }

    return NextResponse.json({ run, remote }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
