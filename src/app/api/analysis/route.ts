import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { analysisJobs, aiAnalyses, thesisVersions } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export const runtime = 'nodejs';

/** Recent analyses, newest first — feeds the AI Intelligence page. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const securityId = url.searchParams.get('securityId');

  const q = db.select().from(aiAnalyses).orderBy(desc(aiAnalyses.analysisTimestamp)).limit(50);
  const rows = securityId
    ? await db.select().from(aiAnalyses).where(eq(aiAnalyses.securityId, securityId)).orderBy(desc(aiAnalyses.analysisTimestamp))
    : await q;

  return NextResponse.json({ analyses: rows });
}

/**
 * Enqueue an analysis. Returns 202 immediately.
 *
 * ADR-009: an Agenteki run is minutes of LLM calls with unpredictable duration
 * and MUST NOT execute inside an HTTP request. This handler writes a job row;
 * the cron worker picks it up; the client polls GET /api/analysis.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { securityId, portfolioId, jobType = 'single_security' } = body as {
    securityId?: string; portfolioId?: string; jobType?: string;
  };

  if (jobType === 'single_security' && !securityId) {
    return NextResponse.json({ error: 'securityId required for single_security jobs' }, { status: 400 });
  }

  const [thesis] = await db
    .select({ id: thesisVersions.id })
    .from(thesisVersions)
    .orderBy(desc(thesisVersions.versionNumber))
    .limit(1);

  if (!thesis) {
    return NextResponse.json(
      { error: 'No thesis version exists. Agenteki cannot score against nothing — seed a thesis first.' },
      { status: 409 }
    );
  }

  const [job] = await db
    .insert(analysisJobs)
    .values({ status: 'pending', jobType, securityId, portfolioId, thesisVersionId: thesis.id })
    .returning();

  return NextResponse.json(
    { job, message: 'Queued. Poll GET /api/analysis or check job status.' },
    { status: 202 }
  );
}
