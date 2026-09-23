import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-auth';
import { db } from '@/lib/db';
import {
  discoveryCandidates,
  externalAgenticRuns,
  marketDataObservations,
  valuationScenarios,
} from '@/lib/db/workflow-schema';
import {
  analysisModeFromRequest,
  isDcfLocked,
  LIMITED_DATA_DCF_LOCK_REASON,
} from '@/lib/integrations/analysis-mode';
import { assessDcfSuitability, threeCaseDiscountedCashFlow } from '@/lib/quant/dcf';

export const runtime = 'nodejs';

const automaticValuationSchema = z.object({
  candidateId: z.string().uuid(),
  automatic: z.literal(true),
}).strict();

const SCENARIO_DRIVERS = {
  worst_case: {
    annualGrowthRate: 'dcf_worst_case_fcf_growth_rate',
    discountRate: 'dcf_worst_case_discount_rate',
    terminalGrowthRate: 'dcf_worst_case_terminal_growth_rate',
  },
  base_case: {
    annualGrowthRate: 'dcf_base_case_fcf_growth_rate',
    discountRate: 'dcf_base_case_discount_rate',
    terminalGrowthRate: 'dcf_base_case_terminal_growth_rate',
  },
  optimistic_case: {
    annualGrowthRate: 'dcf_optimistic_case_fcf_growth_rate',
    discountRate: 'dcf_optimistic_case_discount_rate',
    terminalGrowthRate: 'dcf_optimistic_case_terminal_growth_rate',
  },
} as const;

const REQUIRED_AUTOMATIC_FINANCIALS = ['free_cash_flow', 'total_debt', 'cash_and_equivalents', 'shares_outstanding'] as const;
const REQUIRED_AUTOMATIC_DRIVERS = Object.values(SCENARIO_DRIVERS).flatMap((scenario) => Object.values(scenario));

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
  const [run] = candidate.externalAnalysisRunId
    ? await db.select().from(externalAgenticRuns).where(and(
      eq(externalAgenticRuns.ownerId, ownerId),
      eq(externalAgenticRuns.externalRunId, candidate.externalAnalysisRunId)
    )).limit(1)
    : [];
  const analysisMode = run
    ? analysisModeFromRequest(run.requestJson, candidate.ticker, candidate.exchange)
    : null;
  return { candidate, observations, latest, analysisMode };
}

function numeric(row: { valueNumeric: string | null } | undefined): number | null {
  if (!row?.valueNumeric) return null;
  const value = Number(row.valueNumeric);
  return Number.isFinite(value) ? value : null;
}

function hasCompletePrimarySourceDcf(data: NonNullable<Awaited<ReturnType<typeof context>>>): boolean {
  return REQUIRED_AUTOMATIC_FINANCIALS.every((metric) => data.latest.get(metric)?.provider === 'investor-relations');
}

function automaticReadiness(data: NonNullable<Awaited<ReturnType<typeof context>>>) {
  const missingFinancialRecords = REQUIRED_AUTOMATIC_FINANCIALS.filter((metric) => {
    const value = numeric(data.latest.get(metric));
    return value == null || data.latest.get(metric)?.provider !== 'investor-relations';
  });
  const missingScenarioDrivers = REQUIRED_AUTOMATIC_DRIVERS.filter((metric) => numeric(data.latest.get(metric)) == null);
  return {
    ready: missingFinancialRecords.length === 0 && missingScenarioDrivers.length === 0,
    missingFinancialRecords,
    missingScenarioDrivers,
    message: missingFinancialRecords.length || missingScenarioDrivers.length
      ? 'Strict automatic DCF is paused because source-linked financial records or scenario-driver records are missing. The platform will not insert an estimated growth, discount, or terminal rate.'
      : 'All source-linked financial and scenario-driver records are present. The native three-scenario DCF can be generated.',
  };
}

export async function GET(req: Request) {
  const session = await authenticateRequest(req);
  if (!session.ok) return session.response;
  const candidateId = new URL(req.url).searchParams.get('candidateId');
  if (!candidateId) return NextResponse.json({ error: 'candidateId is required' }, { status: 400 });
  const data = await context(session.auth.userId, candidateId);
  if (!data) return NextResponse.json({ error: 'Analyzed discovery candidate not found' }, { status: 404 });
  if (isDcfLocked(data.analysisMode) && !hasCompletePrimarySourceDcf(data)) {
    return NextResponse.json({ error: LIMITED_DATA_DCF_LOCK_REASON }, { status: 409 });
  }
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
    automaticReadiness: automaticReadiness(data),
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
  const body = await req.json().catch(() => ({}));
  const parsed = automaticValuationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: 'Strict automatic DCF accepts only { candidateId, automatic: true }. The platform does not accept user-entered valuation assumptions.',
    }, { status: 400 });
  }
  const candidateId = parsed.data.candidateId;
  const data = await context(session.auth.userId, candidateId);
  if (data && isDcfLocked(data.analysisMode) && !hasCompletePrimarySourceDcf(data)) {
    return NextResponse.json({ error: LIMITED_DATA_DCF_LOCK_REASON }, { status: 409 });
  }
  if (!data || !data.candidate.analysisId) {
    return NextResponse.json({ error: 'Complete the approved security analysis before valuation' }, { status: 409 });
  }
  const readiness = automaticReadiness(data);
  if (!readiness.ready) return NextResponse.json({ error: readiness.message, readiness }, { status: 409 });
  const freeCashFlow = numeric(data.latest.get('free_cash_flow'))!;
  const totalDebt = numeric(data.latest.get('total_debt'))!;
  const cash = numeric(data.latest.get('cash_and_equivalents'))!;
  const sharesOutstanding = numeric(data.latest.get('shares_outstanding'))!;
  const references = [
    ...REQUIRED_AUTOMATIC_FINANCIALS,
    ...REQUIRED_AUTOMATIC_DRIVERS,
  ].map((metric) => `fundamental:${metric}:${data.latest.get(metric)!.id}`);
  try {
    const assumptions = Object.fromEntries(Object.entries(SCENARIO_DRIVERS).map(([name, drivers]) => [name, {
      currency: data.candidate.currency,
      startingFreeCashFlow: freeCashFlow,
      forecastYears: 5,
      annualGrowthRate: numeric(data.latest.get(drivers.annualGrowthRate))!,
      discountRate: numeric(data.latest.get(drivers.discountRate))!,
      terminalGrowthRate: numeric(data.latest.get(drivers.terminalGrowthRate))!,
      netDebt: totalDebt - cash,
      sharesOutstanding,
      dataAsOf: data.observations[0]?.retrievedAt.toISOString() ?? new Date().toISOString(),
      sourceReferences: references,
    }])) as Parameters<typeof threeCaseDiscountedCashFlow>[0];
    const result = threeCaseDiscountedCashFlow(assumptions);
    const [scenario] = await db.insert(valuationScenarios).values({
      ownerId: session.auth.userId,
      candidateId: data.candidate.id,
      analysisId: data.candidate.analysisId,
      method: result.method,
      status: 'source_complete',
      assumptionsJson: assumptions,
      resultJson: result,
      sourceReferences: references,
      approvedBy: session.auth.email,
    }).returning();
    return NextResponse.json({ scenario, result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
