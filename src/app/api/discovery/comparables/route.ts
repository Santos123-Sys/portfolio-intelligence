import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { discoveryCandidates, marketDataObservations, valuationScenarios } from '@/lib/db/workflow-schema';
import { comparableCompanyAnalysis } from '@/lib/quant/comparables';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';

const peerSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  ticker: z.string().trim().min(1).max(30),
  marketCapitalization: z.number().positive(),
  netDebt: z.number().finite(),
  totalDebt: z.number().finite().optional(),
  minorityInterest: z.number().finite().optional(),
  preferredStock: z.number().finite().optional(),
  revenue: z.number().finite().optional(),
  ebitda: z.number().finite().optional(),
  netIncome: z.number().finite().optional(),
  grossProfit: z.number().finite().optional(),
  operatingIncome: z.number().finite().optional(),
  totalEquity: z.number().finite().optional(),
  interestExpense: z.number().finite().optional(),
  ntmRevenue: z.number().finite().optional(),
  ntmEbitda: z.number().finite().optional(),
  ntmNetIncome: z.number().finite().optional(),
  sourceUrl: z.string().url(),
  forecastSourceUrl: z.string().url().optional(),
}).strict();

const requestSchema = z.object({
  candidateId: z.string().uuid(),
  peers: z.array(peerSchema).min(6).max(10),
  methodSuitabilityConfirmed: z.literal(true),
}).strict();

function numeric(row: { valueNumeric: string | null } | undefined): number | undefined {
  if (!row?.valueNumeric) return undefined;
  const value = Number(row.valueNumeric);
  return Number.isFinite(value) ? value : undefined;
}

async function context(ownerId: string, candidateId: string) {
  const [candidate] = await db.select().from(discoveryCandidates).where(and(
    eq(discoveryCandidates.id, candidateId),
    eq(discoveryCandidates.ownerId, ownerId)
  )).limit(1);
  if (!candidate || !candidate.securityId || !candidate.analysisId) return null;
  const observations = await db.select().from(marketDataObservations).where(and(
    eq(marketDataObservations.securityId, candidate.securityId),
    eq(marketDataObservations.observationType, 'fundamental'),
    eq(marketDataObservations.status, 'OK')
  )).orderBy(desc(marketDataObservations.retrievedAt));
  const latest = new Map<string, typeof observations[number]>();
  for (const observation of observations) if (!latest.has(observation.metricName)) latest.set(observation.metricName, observation);
  const debt = numeric(latest.get('total_debt'));
  const cash = numeric(latest.get('cash_and_equivalents'));
  return {
    candidate,
    observations,
    target: {
      companyName: candidate.companyName,
      currency: candidate.currency,
      revenue: numeric(latest.get('revenue')),
      ebitda: numeric(latest.get('ebitda')),
      netIncome: numeric(latest.get('net_income')),
      netDebt: debt != null && cash != null ? debt - cash : undefined,
      sharesOutstanding: numeric(latest.get('shares_outstanding')),
    },
    sourceReferences: [...latest.values()].map((row) => `fundamental:${row.metricName}:${row.id}`),
    dataAsOf: observations[0]?.retrievedAt.toISOString() ?? null,
  };
}

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const candidateId = new URL(req.url).searchParams.get('candidateId');
  if (!candidateId) return NextResponse.json({ error: 'candidateId is required' }, { status: 400 });
  const data = await context(session.auth.userId, candidateId);
  if (!data) return NextResponse.json({ error: 'Complete the approved security analysis before comparable-company valuation' }, { status: 409 });
  const available = Object.entries(data.target).filter(([, value]) => value != null).map(([key]) => key);
  const [latestScenario] = await db.select().from(valuationScenarios).where(and(
    eq(valuationScenarios.ownerId, session.auth.userId),
    eq(valuationScenarios.candidateId, candidateId),
    eq(valuationScenarios.method, 'comparable_companies')
  )).orderBy(desc(valuationScenarios.createdAt)).limit(1);
  return NextResponse.json({
    target: data.target,
    dataAsOf: data.dataAsOf,
    available,
    missing: ['revenue', 'ebitda', 'netIncome'].filter((key) => !(key in data.target) || data.target[key as keyof typeof data.target] == null),
    latestScenario: latestScenario ?? null,
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
  const body = await readBoundedJson(req, 64 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = requestSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = await context(session.auth.userId, parsed.data.candidateId);
  if (!data) return NextResponse.json({ error: 'Complete the approved security analysis before comparable-company valuation' }, { status: 409 });
  try {
    const result = comparableCompanyAnalysis(data.target, parsed.data.peers);
    const [scenario] = await db.insert(valuationScenarios).values({
      ownerId: session.auth.userId,
      candidateId: data.candidate.id,
      analysisId: data.candidate.analysisId,
      method: result.method,
      status: 'human_confirmed',
      assumptionsJson: { target: data.target, peers: parsed.data.peers, dataAsOf: data.dataAsOf },
      resultJson: result,
      sourceReferences: parsed.data.peers.flatMap((peer) => [peer.sourceUrl, peer.forecastSourceUrl].filter((url): url is string => Boolean(url))),
      approvedBy: session.auth.email,
    }).returning();
    return NextResponse.json({ scenario, result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
