import { NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { externalAgenticRuns } from '@/lib/db/workflow-schema';
import { portfolios, thesisVersions } from '@/lib/db/schema';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { AgenticRunRequest } from '@/lib/integrations/agentic-contract';
import { fetchExternalAgenticRun, startExternalAgenticRun } from '@/lib/integrations/agentic-client';

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

  const runs = await db
    .select({
      externalRunId: externalAgenticRuns.externalRunId,
      status: externalAgenticRuns.status,
      thesisVersion: externalAgenticRuns.thesisVersion,
      requestedAt: externalAgenticRuns.requestedAt,
      completedAt: externalAgenticRuns.completedAt,
      importedAt: externalAgenticRuns.importedAt,
      reportPdfUrl: externalAgenticRuns.reportPdfUrl,
    })
    .from(externalAgenticRuns)
    .where(eq(externalAgenticRuns.ownerId, session.auth.userId))
    .orderBy(desc(externalAgenticRuns.requestedAt))
    .limit(50);

  return NextResponse.json({
    runs: runs.map(({ reportPdfUrl, ...run }) => ({
      ...run,
      reportUrl: reportPdfUrl
        ? `/api/integrations/agentic/reports?externalRunId=${encodeURIComponent(run.externalRunId)}`
        : null,
    })),
  });
}

export async function POST(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  try {
    assertSameOrigin(req);
  } catch {
    return NextResponse.json({ error: 'Cross-origin mutation rejected' }, { status: 403 });
  }

  const parsed = AgenticRunRequest.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const requestedPortfolioIds = [...new Set(parsed.data.portfolios.map((portfolio) => portfolio.id))];
  if (requestedPortfolioIds.length !== parsed.data.portfolios.length) {
    return NextResponse.json({ error: 'Portfolio IDs must be unique' }, { status: 400 });
  }
  const requestedSecurityKeys = parsed.data.securities.map((security) =>
    `${security.portfolioId}:${security.exchange}:${security.ticker}`
  );
  if (new Set(requestedSecurityKeys).size !== requestedSecurityKeys.length) {
    return NextResponse.json({ error: 'Security requests must be unique per portfolio and exchange' }, { status: 400 });
  }
  const ownedPortfolios = await db.select({ id: portfolios.id }).from(portfolios)
    .where(and(inArray(portfolios.id, requestedPortfolioIds), eq(portfolios.ownerId, session.auth.userId)));
  if (ownedPortfolios.length !== requestedPortfolioIds.length ||
      parsed.data.securities.some((security) => !requestedPortfolioIds.includes(security.portfolioId))) {
    return NextResponse.json({ error: 'One or more portfolios are not owned by the authenticated user' }, { status: 403 });
  }
  const [thesis] = await db.select({ id: thesisVersions.id, versionNumber: thesisVersions.versionNumber })
    .from(thesisVersions)
    .where(and(
      eq(thesisVersions.id, parsed.data.thesis.versionId),
      eq(thesisVersions.ownerId, session.auth.userId)
    ))
    .limit(1);
  if (!thesis || thesis.versionNumber !== parsed.data.thesis.criteria.version) {
    return NextResponse.json({ error: 'Thesis version does not belong to the authenticated user or does not match the criteria' }, { status: 403 });
  }

  try {
    const remote = await startExternalAgenticRun(parsed.data);
    const [collision] = await db.select({ ownerId: externalAgenticRuns.ownerId })
      .from(externalAgenticRuns)
      .where(eq(externalAgenticRuns.externalRunId, remote.externalRunId))
      .limit(1);
    if (collision && collision.ownerId !== session.auth.userId) {
      return NextResponse.json({ error: 'External run ID collision' }, { status: 409 });
    }
    const [run] = await db
      .insert(externalAgenticRuns)
      .values({
        ownerId: session.auth.userId,
        externalRunId: remote.externalRunId,
        status: remote.status,
        thesisVersion: String(parsed.data.thesis.criteria.version),
        reportPdfUrl: remote.reportPdfUrl,
        errorMessage: remote.errorMessage,
        requestJson: parsed.data,
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

    if (run.ownerId !== session.auth.userId) {
      return NextResponse.json({ error: 'External run ID collision' }, { status: 409 });
    }

    return NextResponse.json({ run, remote }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
