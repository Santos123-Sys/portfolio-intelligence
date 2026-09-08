import { and, desc, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { portfolios, thesisVersions } from '@/lib/db/schema';
import { discoveryCandidates, externalDiscoveryRuns } from '@/lib/db/workflow-schema';

export const runtime = 'nodejs';

/** The newest research queue, deliberately separate from owned holdings. */
export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;

  const [latestRun] = await db.select({
    id: externalDiscoveryRuns.id,
    requestedAt: externalDiscoveryRuns.requestedAt,
    completedAt: externalDiscoveryRuns.completedAt,
    provider: externalDiscoveryRuns.provider,
  }).from(externalDiscoveryRuns)
    .innerJoin(thesisVersions, eq(externalDiscoveryRuns.thesisVersionId, thesisVersions.id))
    .where(and(
      eq(externalDiscoveryRuns.ownerId, session.auth.userId),
      eq(externalDiscoveryRuns.status, 'completed'),
      isNull(thesisVersions.excludedAt)
    ))
    .orderBy(desc(externalDiscoveryRuns.completedAt), desc(externalDiscoveryRuns.requestedAt))
    .limit(1);
  if (!latestRun) return NextResponse.json({ latestRun: null, candidates: [] });

  const candidates = await db.select({
    id: discoveryCandidates.id,
    ticker: discoveryCandidates.ticker,
    companyName: discoveryCandidates.companyName,
    country: discoveryCandidates.country,
    sector: discoveryCandidates.sector,
    decision: discoveryCandidates.decision,
    workflowStatus: discoveryCandidates.workflowStatus,
    discoveryJson: discoveryCandidates.discoveryJson,
    portfolioName: portfolios.name,
  }).from(discoveryCandidates)
    .innerJoin(portfolios, eq(discoveryCandidates.portfolioId, portfolios.id))
    .where(and(
      eq(discoveryCandidates.ownerId, session.auth.userId),
      eq(discoveryCandidates.runId, latestRun.id)
    ))
    .orderBy(desc(discoveryCandidates.createdAt));

  return NextResponse.json({
    latestRun,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      thesisAlignmentScore: (candidate.discoveryJson as { thesisAlignmentScore?: number })?.thesisAlignmentScore ?? null,
    })),
  });
}
