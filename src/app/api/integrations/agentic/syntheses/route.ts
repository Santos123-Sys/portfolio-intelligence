import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { portfolios } from '@/lib/db/schema';
import { externalAgenticRuns, portfolioAnalysisSyntheses } from '@/lib/db/workflow-schema';
import { authenticateRequest, portfolioIsOwned } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;

  const portfolioId = new URL(req.url).searchParams.get('portfolioId');
  if (portfolioId && !(await portfolioIsOwned(session.auth.userId, portfolioId))) {
    return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
  }
  const base = db
    .select({
      id: portfolioAnalysisSyntheses.id,
      runId: externalAgenticRuns.externalRunId,
      portfolioId: portfolioAnalysisSyntheses.portfolioId,
      portfolioName: portfolios.name,
      thesisVersion: portfolioAnalysisSyntheses.thesisVersion,
      synthesis: portfolioAnalysisSyntheses.synthesisJson,
      reportAvailable: externalAgenticRuns.reportPdfUrl,
      generatedAt: externalAgenticRuns.completedAt,
      importedAt: externalAgenticRuns.importedAt,
    })
    .from(portfolioAnalysisSyntheses)
    .innerJoin(externalAgenticRuns, eq(portfolioAnalysisSyntheses.runId, externalAgenticRuns.id))
    .innerJoin(portfolios, eq(portfolioAnalysisSyntheses.portfolioId, portfolios.id));

  const rows = portfolioId
    ? await base
        .where(and(
          eq(externalAgenticRuns.ownerId, session.auth.userId),
          eq(portfolioAnalysisSyntheses.portfolioId, portfolioId)
        ))
        .orderBy(desc(externalAgenticRuns.completedAt))
    : await base.where(eq(externalAgenticRuns.ownerId, session.auth.userId))
        .orderBy(desc(externalAgenticRuns.completedAt)).limit(50);

  return NextResponse.json({
    syntheses: rows.map(({ reportAvailable, ...row }) => ({
      ...row,
      reportUrl: reportAvailable
        ? `/api/integrations/agentic/reports?externalRunId=${encodeURIComponent(row.runId)}`
        : null,
    })),
  });
}
