import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { portfolios } from '@/lib/db/schema';
import { externalAgenticRuns, portfolioAnalysisSyntheses } from '@/lib/db/workflow-schema';
import { assertMutationAuthorized } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    assertMutationAuthorized(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }

  const portfolioId = new URL(req.url).searchParams.get('portfolioId');
  const base = db
    .select({
      id: portfolioAnalysisSyntheses.id,
      runId: externalAgenticRuns.externalRunId,
      portfolioId: portfolioAnalysisSyntheses.portfolioId,
      portfolioName: portfolios.name,
      thesisVersion: portfolioAnalysisSyntheses.thesisVersion,
      synthesis: portfolioAnalysisSyntheses.synthesisJson,
      reportPdfUrl: externalAgenticRuns.reportPdfUrl,
      generatedAt: externalAgenticRuns.completedAt,
      importedAt: externalAgenticRuns.importedAt,
    })
    .from(portfolioAnalysisSyntheses)
    .innerJoin(externalAgenticRuns, eq(portfolioAnalysisSyntheses.runId, externalAgenticRuns.id))
    .innerJoin(portfolios, eq(portfolioAnalysisSyntheses.portfolioId, portfolios.id));

  const rows = portfolioId
    ? await base
        .where(eq(portfolioAnalysisSyntheses.portfolioId, portfolioId))
        .orderBy(desc(externalAgenticRuns.completedAt))
    : await base.orderBy(desc(externalAgenticRuns.completedAt)).limit(50);

  return NextResponse.json({ syntheses: rows });
}
