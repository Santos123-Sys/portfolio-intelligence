import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getPriceProvider } from '@/lib/connectors';
import { loadDiscoveryLatestPrices } from '@/lib/discovery-market-data';
import { scoreDiscoveryEvidence } from '@/lib/discovery-evidence';
import { DiscoveryCandidate } from '@portfolio-intelligence/agentic-contract';
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
    exchange: discoveryCandidates.exchange,
    companyName: discoveryCandidates.companyName,
    country: discoveryCandidates.country,
    sector: discoveryCandidates.sector,
    industry: discoveryCandidates.industry,
    classificationSource: discoveryCandidates.classificationSource,
    decision: discoveryCandidates.decision,
    workflowStatus: discoveryCandidates.workflowStatus,
    discoveryJson: discoveryCandidates.discoveryJson,
    portfolioName: portfolios.name,
  }).from(discoveryCandidates)
    .innerJoin(portfolios, eq(discoveryCandidates.portfolioId, portfolios.id))
    .where(and(
      eq(discoveryCandidates.ownerId, session.auth.userId),
      eq(discoveryCandidates.runId, latestRun.id),
      ne(discoveryCandidates.decision, 'rejected')
    ))
    .orderBy(desc(discoveryCandidates.createdAt));

  let latestPrices = new Map();
  try {
    latestPrices = await loadDiscoveryLatestPrices(candidates.map((candidate) => ({
      id: candidate.id,
      ticker: candidate.ticker,
      exchange: candidate.exchange,
    })), getPriceProvider());
  } catch {
    // The Positions overview is still useful if a live quote is unavailable.
  }

  return NextResponse.json({
    latestRun,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      latestPrice: latestPrices.get(candidate.id) ?? null,
      thesisAlignmentScore: (candidate.discoveryJson as { thesisAlignmentScore?: number })?.thesisAlignmentScore ?? null,
      evidenceScorecard: scoreDiscoveryEvidence(
        DiscoveryCandidate.parse(candidate.discoveryJson),
        latestPrices.get(candidate.id) ?? null
      ),
    })),
  });
}
