import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { discoveryCandidates, marketDataObservations, valuationScenarios } from '@/lib/db/workflow-schema';
import { assessDcfSuitability, discountedCashFlow } from '@/lib/quant/dcf';

export const runtime = 'nodejs';

const valuationSchema = z.object({
  candidateId: z.string().uuid(),
  startingFreeCashFlow: z.number().positive(),
  forecastYears: z.number().int().min(1).max(10),
  annualGrowthRate: z.number().min(-0.5).max(0.5),
  discountRate: z.number().positive().max(0.5),
  terminalGrowthRate: z.number().min(-0.05).max(0.05),
  netDebt: z.number().finite(),
  sharesOutstanding: z.number().positive(),
  sourceReferences: z.array(z.string().min(1)).min(1),
  methodSuitabilityConfirmed: z.boolean(),
}).strict();

async function context(ownerId: string, candidateId: string) {
  const [candidate] = await db.select().from(discoveryCandidates).where(and(
    eq(discoveryCandidates.id, candidateId),
    eq(discoveryCandidates.ownerId, ownerId)
  )).limit(1);
  if (!candidate || !candidate.securityId) return null;
  const observations = await db.select().from(marketDataObservations).where(and(
    eq(marketDataObservations.securityId, candidate.securityId),
    eq(marketDataObservations.observationType, 'fundamental'),
    eq(marketDataObservations.status, 'OK')
  )).orderBy(desc(marketDataObservations.retrievedAt));
  const latest = new Map<string, typeof observations[number]>();
  for (const observation of observations) if (!latest.has(observation.metricName)) latest.set(observation.metricName, observation);
  return { candidate, observations, latest };
}

function numeric(row: { valueNumeric: string | null } | undefined): number | null {
  if (!row?.valueNumeric) return null;
  const value = Number(row.valueNumeric);
  return Number.isFinite(value) ? value : null;
}

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const candidateId = new URL(req.url).searchParams.get('candidateId');
  if (!candidateId) return NextResponse.json({ error: 'candidateId is required' }, { status: 400 });
  const data = await context(session.auth.userId, candidateId);
  if (!data) return NextResponse.json({ error: 'Analyzed discovery candidate not found' }, { status: 404 });
  const suitability = assessDcfSuitability(data.candidate.sector, data.latest.keys());
  const debt = numeric(data.latest.get('total_debt'));
  const cash = numeric(data.latest.get('cash_and_equivalents'));
  const sourceReferences = [...data.latest.values()].map((row) => `fundamental:${row.metricName}:${row.id}`);
  const [latestScenario] = await db.select().from(valuationScenarios).where(and(
    eq(valuationScenarios.ownerId, session.auth.userId),
    eq(valuationScenarios.candidateId, candidateId)
  )).orderBy(desc(valuationScenarios.createdAt)).limit(1);
  return NextResponse.json({
    suitability,
    defaults: {
      startingFreeCashFlow: numeric(data.latest.get('free_cash_flow')),
      netDebt: debt != null && cash != null ? debt - cash : null,
      sharesOutstanding: numeric(data.latest.get('shares_outstanding')),
      forecastYears: 5,
      annualGrowthRate: null,
      discountRate: null,
      terminalGrowthRate: null,
      currency: data.candidate.currency,
      dataAsOf: data.observations[0]?.retrievedAt.toISOString() ?? null,
      sourceReferences,
    },
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
  const parsed = valuationSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = await context(session.auth.userId, parsed.data.candidateId);
  if (!data || !data.candidate.analysisId) {
    return NextResponse.json({ error: 'Complete the approved security analysis before valuation' }, { status: 409 });
  }
  const suitability = assessDcfSuitability(data.candidate.sector, data.latest.keys());
  if (suitability.status === 'insufficient_data') {
    return NextResponse.json({ error: suitability.rationale }, { status: 409 });
  }
  if (suitability.status === 'alternative_method_recommended' && !parsed.data.methodSuitabilityConfirmed) {
    return NextResponse.json({ error: suitability.rationale }, { status: 409 });
  }
  const allowedReferences = new Set(data.observations.map((row) => `fundamental:${row.metricName}:${row.id}`));
  const invalid = parsed.data.sourceReferences.filter((reference) => !allowedReferences.has(reference));
  if (invalid.length) return NextResponse.json({ error: `Unknown valuation evidence: ${invalid.join(', ')}` }, { status: 400 });
  try {
    const assumptions = {
      currency: data.candidate.currency,
      startingFreeCashFlow: parsed.data.startingFreeCashFlow,
      forecastYears: parsed.data.forecastYears,
      annualGrowthRate: parsed.data.annualGrowthRate,
      discountRate: parsed.data.discountRate,
      terminalGrowthRate: parsed.data.terminalGrowthRate,
      netDebt: parsed.data.netDebt,
      sharesOutstanding: parsed.data.sharesOutstanding,
      dataAsOf: data.observations[0]?.retrievedAt.toISOString() ?? new Date().toISOString(),
      sourceReferences: parsed.data.sourceReferences,
    };
    const result = discountedCashFlow(assumptions);
    const [scenario] = await db.insert(valuationScenarios).values({
      ownerId: session.auth.userId,
      candidateId: data.candidate.id,
      analysisId: data.candidate.analysisId,
      method: result.method,
      status: 'human_confirmed',
      assumptionsJson: assumptions,
      resultJson: result,
      sourceReferences: parsed.data.sourceReferences,
      approvedBy: session.auth.email,
    }).returning();
    return NextResponse.json({ scenario, result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
