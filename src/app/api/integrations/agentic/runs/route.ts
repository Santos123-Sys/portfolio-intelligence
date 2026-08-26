import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { externalAgenticRuns } from '@/lib/db/workflow-schema';
import { assertMutationAuthorized } from '@/lib/auth';
import { AgenticRunRequest } from '@/lib/integrations/agentic-contract';
import { fetchExternalAgenticRun, startExternalAgenticRun } from '@/lib/integrations/agentic-client';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const externalRunId = new URL(req.url).searchParams.get('externalRunId');

  if (externalRunId) {
    const [local] = await db
      .select()
      .from(externalAgenticRuns)
      .where(eq(externalAgenticRuns.externalRunId, externalRunId))
      .limit(1);

    if (!local) return NextResponse.json({ error: 'External run not found' }, { status: 404 });

    try {
      const remote = await fetchExternalAgenticRun(externalRunId);
      const [updated] = await db
        .update(externalAgenticRuns)
        .set({
          status: remote.status,
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

  const runs = await db
    .select()
    .from(externalAgenticRuns)
    .orderBy(desc(externalAgenticRuns.requestedAt))
    .limit(50);

  return NextResponse.json({ runs });
}

export async function POST(req: Request) {
  try {
    assertMutationAuthorized(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }

  const parsed = AgenticRunRequest.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const remote = await startExternalAgenticRun(parsed.data);
    const [run] = await db
      .insert(externalAgenticRuns)
      .values({
        externalRunId: remote.externalRunId,
        status: remote.status,
        thesisVersion: String(parsed.data.thesis.criteria.version),
        reportPdfUrl: remote.reportPdfUrl,
        errorMessage: remote.errorMessage,
      })
      .onConflictDoUpdate({
        target: externalAgenticRuns.externalRunId,
        set: {
          status: remote.status,
          reportPdfUrl: remote.reportPdfUrl,
          errorMessage: remote.errorMessage,
        },
      })
      .returning();

    return NextResponse.json({ run, remote }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
