import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { externalAgenticRuns } from '@/lib/db/workflow-schema';
import { fetchExternalAgenticReport } from '@/lib/integrations/agentic-client';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const externalRunId = new URL(req.url).searchParams.get('externalRunId');
  if (!externalRunId) return NextResponse.json({ error: 'externalRunId is required' }, { status: 400 });

  const [run] = await db.select({ id: externalAgenticRuns.id })
    .from(externalAgenticRuns)
    .where(and(
      eq(externalAgenticRuns.externalRunId, externalRunId),
      eq(externalAgenticRuns.ownerId, session.auth.userId)
    ))
    .limit(1);
  if (!run) return NextResponse.json({ error: 'External run not found' }, { status: 404 });

  try {
    const remote = await fetchExternalAgenticReport(externalRunId);
    return new Response(remote.body, {
      status: 200,
      headers: {
        'content-type': remote.headers.get('content-type') ?? 'application/pdf',
        'content-disposition': remote.headers.get('content-disposition') ?? `inline; filename="analysis-${externalRunId}.pdf"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
