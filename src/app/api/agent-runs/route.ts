import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentRuns, agentSteps } from '@/lib/db/agentic-schema';
import { securities } from '@/lib/db/schema';
import { eq, desc, asc } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get('runId');

  if (runId) {
    const [run] = await db.select({
      id: agentRuns.id,
      status: agentRuns.status,
      securityId: agentRuns.securityId,
      ticker: securities.ticker,
      companyName: securities.companyName,
      thesisVersionId: agentRuns.thesisVersionId,
      orchestratorVersion: agentRuns.orchestratorVersion,
      startedAt: agentRuns.startedAt,
      completedAt: agentRuns.completedAt,
      errorMessage: agentRuns.errorMessage,
    }).from(agentRuns)
      .innerJoin(securities, eq(agentRuns.securityId, securities.id))
      .where(eq(agentRuns.id, runId));

    if (!run) return NextResponse.json({ error: 'Agent run not found' }, { status: 404 });
    const steps = await db.select().from(agentSteps)
      .where(eq(agentSteps.runId, runId)).orderBy(asc(agentSteps.sequence));
    return NextResponse.json({ run, steps });
  }

  const runs = await db.select({
    id: agentRuns.id,
    status: agentRuns.status,
    ticker: securities.ticker,
    companyName: securities.companyName,
    orchestratorVersion: agentRuns.orchestratorVersion,
    startedAt: agentRuns.startedAt,
    completedAt: agentRuns.completedAt,
    errorMessage: agentRuns.errorMessage,
  }).from(agentRuns)
    .innerJoin(securities, eq(agentRuns.securityId, securities.id))
    .orderBy(desc(agentRuns.startedAt)).limit(50);

  return NextResponse.json({ runs });
}
