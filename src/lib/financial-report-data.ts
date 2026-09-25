import { and, desc, eq } from 'drizzle-orm';
import { db } from './db';
import { discoveryCandidates, marketDataObservations } from './db/workflow-schema';
import { buildFinancialAnalysisReport } from './financial-analysis-report';

export async function loadFinancialAnalysisReport(ownerId: string, candidateId: string) {
  const [candidate] = await db.select().from(discoveryCandidates).where(and(
    eq(discoveryCandidates.id, candidateId), eq(discoveryCandidates.ownerId, ownerId)
  )).limit(1);
  if (!candidate?.securityId || !candidate.analysisId) return null;
  const observations = await db.select().from(marketDataObservations).where(and(
    eq(marketDataObservations.securityId, candidate.securityId),
    eq(marketDataObservations.observationType, 'fundamental'),
    eq(marketDataObservations.status, 'OK')
  )).orderBy(desc(marketDataObservations.retrievedAt));
  return buildFinancialAnalysisReport({ companyName: candidate.companyName, ticker: candidate.ticker,
    exchange: candidate.exchange, currency: candidate.currency, observations });
}
