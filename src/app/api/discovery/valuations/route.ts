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
import { assessDcfSuitability, calculateWacc, integrateSourcedCompsExit, threeCaseDiscountedCashFlow } from '@/lib/quant/dcf';

export const runtime = 'nodejs';

const automaticValuationSchema = z.object({
  candidateId: z.string().uuid(),
  automatic: z.literal(true),
}).strict();

const SCENARIO_DRIVERS = {
  worst_case: {
    annualGrowthRate: 'dcf_worst_case_fcf_growth_rate',
    annualEbitdaGrowthRate: 'dcf_worst_case_ebitda_growth_rate',
    terminalGrowthRate: 'dcf_worst_case_terminal_growth_rate',
  },
  base_case: {
    annualGrowthRate: 'dcf_base_case_fcf_growth_rate',
    annualEbitdaGrowthRate: 'dcf_base_case_ebitda_growth_rate',
    terminalGrowthRate: 'dcf_base_case_terminal_growth_rate',
  },
  optimistic_case: {
    annualGrowthRate: 'dcf_optimistic_case_fcf_growth_rate',
    annualEbitdaGrowthRate: 'dcf_optimistic_case_ebitda_growth_rate',
    terminalGrowthRate: 'dcf_optimistic_case_terminal_growth_rate',
  },
} as const;

const REQUIRED_AUTOMATIC_FINANCIALS = ['free_cash_flow', 'ebitda', 'total_debt', 'cash_and_equivalents', 'shares_outstanding'] as const;
const WACC_RECORDS = {
  riskFreeRate: 'dcf_risk_free_rate',
  marketRiskPremium: 'dcf_market_risk_premium',
  beta: 'dcf_beta',
  costOfDebt: 'dcf_cost_of_debt',
  taxRate: 'dcf_tax_rate',
  debtToCapital: 'dcf_target_debt_to_capital',
} as const;
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

function hasHttpSource(row: { sourceUrl: string | null } | undefined): boolean {
  if (!row?.sourceUrl) return false;
  try { return ['http:', 'https:'].includes(new URL(row.sourceUrl).protocol); } catch { return false; }
}

function hasCompletePrimarySourceDcf(data: NonNullable<Awaited<ReturnType<typeof context>>>): boolean {
  return REQUIRED_AUTOMATIC_FINANCIALS.every((metric) => data.latest.get(metric)?.provider === 'investor-relations');
}

function automaticReadiness(
  data: NonNullable<Awaited<ReturnType<typeof context>>>,
  compsScenario: typeof valuationScenarios.$inferSelect | null,
) {
  const missingFinancialRecords = REQUIRED_AUTOMATIC_FINANCIALS.filter((metric) => {
    const value = numeric(data.latest.get(metric));
    const row = data.latest.get(metric);
    return value == null || row?.provider !== 'investor-relations' || !hasHttpSource(row);
  });
  const missingScenarioDrivers = REQUIRED_AUTOMATIC_DRIVERS.filter((metric) => {
    const row = data.latest.get(metric);
    return numeric(row) == null || !hasHttpSource(row);
  });
  const missingWaccRecords = Object.values(WACC_RECORDS).filter((metric) => {
    const row = data.latest.get(metric);
    return numeric(row) == null || !hasHttpSource(row);
  });
  let waccError: string | null = null;
  if (missingWaccRecords.length === 0) {
    try { calculateWacc(waccInputs(data)); } catch (error) { waccError = (error as Error).message; }
  }
  const comps = compsScenario?.resultJson as {
    statistics?: { evEbitda?: { count?: number; median?: number | null } };
    target?: { currency?: string; revenue?: number; ebitda?: number; netIncome?: number; netDebt?: number; sharesOutstanding?: number };
  } | undefined;
  const missingComparableAnalysis = !compsScenario || (comps?.statistics?.evEbitda?.count ?? 0) < 6
    || !Number.isFinite(comps?.statistics?.evEbitda?.median) || Number(comps?.statistics?.evEbitda?.median) <= 0;
  const currentDebt = numeric(data.latest.get('total_debt'));
  const currentCash = numeric(data.latest.get('cash_and_equivalents'));
  const currentNetDebt = currentDebt != null && currentCash != null ? currentDebt - currentCash : undefined;
  const sameOptionalNumber = (left: number | undefined, right: number | undefined) => left === undefined || right === undefined
    ? left === right
    : Math.abs(left - right) <= Math.max(1e-8, Math.abs(left) * 1e-10);
  const expectedTargetReferences = ['revenue', 'ebitda', 'net_income', 'total_debt', 'cash_and_equivalents', 'shares_outstanding']
    .map((metric) => data.latest.get(metric))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => `fundamental:${row.metricName}:${row.id}`);
  const staleComparableAnalysis = Boolean(compsScenario) && (
    !comps?.target || comps.target.currency !== data.candidate.currency
    || !sameOptionalNumber(comps.target.revenue, numeric(data.latest.get('revenue')) ?? undefined)
    || !sameOptionalNumber(comps.target.ebitda, numeric(data.latest.get('ebitda')) ?? undefined)
    || !sameOptionalNumber(comps.target.netIncome, numeric(data.latest.get('net_income')) ?? undefined)
    || !sameOptionalNumber(comps.target.netDebt, currentNetDebt)
    || !sameOptionalNumber(comps.target.sharesOutstanding, numeric(data.latest.get('shares_outstanding')) ?? undefined)
    || expectedTargetReferences.some((reference) => !compsScenario!.sourceReferences.includes(reference))
  );
  return {
    ready: missingFinancialRecords.length === 0 && missingScenarioDrivers.length === 0 && missingWaccRecords.length === 0 && !waccError && !missingComparableAnalysis && !staleComparableAnalysis,
    missingFinancialRecords,
    missingScenarioDrivers,
    missingWaccRecords,
    waccError,
    missingComparableAnalysis,
    staleComparableAnalysis,
    message: missingFinancialRecords.length || missingScenarioDrivers.length || missingWaccRecords.length || waccError || missingComparableAnalysis || staleComparableAnalysis
      ? 'Integrated valuation is paused because source-backed financials, CAPM/WACC components, scenario drivers, or a reviewed comparable peer set are missing. No growth, discount rate, EBITDA, or exit multiple is invented.'
      : 'The source-backed target records, three-case drivers, and reviewed peer median are present. The integrated DCF + Comps model can be generated.',
  };
}

async function latestComparableScenario(ownerId: string, candidateId: string) {
  const [scenario] = await db.select().from(valuationScenarios).where(and(
    eq(valuationScenarios.ownerId, ownerId),
    eq(valuationScenarios.candidateId, candidateId),
    eq(valuationScenarios.method, 'comparable_companies'),
  )).orderBy(desc(valuationScenarios.createdAt)).limit(1);
  return scenario ?? null;
}

function waccInputs(data: NonNullable<Awaited<ReturnType<typeof context>>>) {
  return {
    riskFreeRate: numeric(data.latest.get(WACC_RECORDS.riskFreeRate))!,
    marketRiskPremium: numeric(data.latest.get(WACC_RECORDS.marketRiskPremium))!,
    beta: numeric(data.latest.get(WACC_RECORDS.beta))!,
    costOfDebt: numeric(data.latest.get(WACC_RECORDS.costOfDebt))!,
    taxRate: numeric(data.latest.get(WACC_RECORDS.taxRate))!,
    debtToCapital: numeric(data.latest.get(WACC_RECORDS.debtToCapital))!,
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
  const compsScenario = await latestComparableScenario(session.auth.userId, candidateId);
  const suitability = assessDcfSuitability(data.candidate.sector, data.latest.keys());
  const debt = numeric(data.latest.get('total_debt'));
  const cash = numeric(data.latest.get('cash_and_equivalents'));
  const sourceReferences = [...data.latest.values()].map((row) => `fundamental:${row.metricName}:${row.id}`);
  const [currentPrice] = await db.select().from(marketDataObservations).where(and(
    eq(marketDataObservations.securityId, data.candidate.securityId!),
    eq(marketDataObservations.observationType, 'price'),
    eq(marketDataObservations.status, 'OK'),
  )).orderBy(desc(marketDataObservations.retrievedAt)).limit(1);
  const [storedScenario] = await db.select().from(valuationScenarios).where(and(
    eq(valuationScenarios.ownerId, session.auth.userId),
    eq(valuationScenarios.candidateId, candidateId),
    eq(valuationScenarios.method, 'three_case_two_stage_fcff')
  )).orderBy(desc(valuationScenarios.createdAt)).limit(1);
  const latestScenario = storedScenario && typeof storedScenario.resultJson === 'object' && storedScenario.resultJson !== null
    && 'comparableCompanies' in storedScenario.resultJson ? storedScenario : null;
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
      currentPrice: currentPrice?.valueNumeric == null || Number(currentPrice.valueNumeric) <= 0 ? null : {
        value: Number(currentPrice.valueNumeric),
        currency: currentPrice.currency ?? data.candidate.currency,
        asOf: currentPrice.observationDate ?? currentPrice.retrievedAt.toISOString(),
        sourceUrl: currentPrice.sourceUrl,
      },
    },
    costOfCapital: (() => {
      try {
        return calculateWacc(waccInputs(data));
      } catch { return null; }
    })(),
    automaticReadiness: automaticReadiness(data, compsScenario),
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
  const compsScenario = await latestComparableScenario(session.auth.userId, candidateId);
  const readiness = automaticReadiness(data, compsScenario);
  if (!readiness.ready) return NextResponse.json({ error: readiness.message, readiness }, { status: 409 });
  const freeCashFlow = numeric(data.latest.get('free_cash_flow'))!;
  const costOfCapital = calculateWacc(waccInputs(data));
  const totalDebt = numeric(data.latest.get('total_debt'))!;
  const cash = numeric(data.latest.get('cash_and_equivalents'))!;
  const sharesOutstanding = numeric(data.latest.get('shares_outstanding'))!;
  const [priceRecord] = await db.select().from(marketDataObservations).where(and(
    eq(marketDataObservations.securityId, data.candidate.securityId!),
    eq(marketDataObservations.observationType, 'price'),
    eq(marketDataObservations.status, 'OK'),
  )).orderBy(desc(marketDataObservations.retrievedAt)).limit(1);
  const references = [
    ...REQUIRED_AUTOMATIC_FINANCIALS,
    ...Object.values(WACC_RECORDS),
    ...REQUIRED_AUTOMATIC_DRIVERS,
  ].map((metric) => `fundamental:${metric}:${data.latest.get(metric)!.id}`);
  try {
    const assumptions = Object.fromEntries(Object.entries(SCENARIO_DRIVERS).map(([name, drivers]) => [name, {
      currency: data.candidate.currency,
      startingFreeCashFlow: freeCashFlow,
      forecastYears: 5,
      annualGrowthRate: numeric(data.latest.get(drivers.annualGrowthRate))!,
      discountRate: costOfCapital.wacc,
      terminalGrowthRate: numeric(data.latest.get(drivers.terminalGrowthRate))!,
      netDebt: totalDebt - cash,
      sharesOutstanding,
      dataAsOf: data.observations[0]?.retrievedAt.toISOString() ?? new Date().toISOString(),
      sourceReferences: references,
    }])) as Parameters<typeof threeCaseDiscountedCashFlow>[0];
    const dcfResult = threeCaseDiscountedCashFlow(assumptions);
    const compsResult = compsScenario!.resultJson as import('@/lib/quant/comparables').ComparableResult;
    const integrated = integrateSourcedCompsExit(dcfResult, {
      startingEbitda: numeric(data.latest.get('ebitda'))!,
      annualEbitdaGrowthRates: {
        worst_case: numeric(data.latest.get(SCENARIO_DRIVERS.worst_case.annualEbitdaGrowthRate))!,
        base_case: numeric(data.latest.get(SCENARIO_DRIVERS.base_case.annualEbitdaGrowthRate))!,
        optimistic_case: numeric(data.latest.get(SCENARIO_DRIVERS.optimistic_case.annualEbitdaGrowthRate))!,
      },
      medianEvEbitda: compsResult.statistics.evEbitda.median!,
      compsScenarioId: compsScenario!.id,
      compsSourceReferences: compsScenario!.sourceReferences,
      compsResult,
    }, costOfCapital);
    const result = {
      ...integrated,
      ...(priceRecord?.valueNumeric != null && Number(priceRecord.valueNumeric) > 0 ? { currentPrice: {
        value: Number(priceRecord.valueNumeric),
        currency: priceRecord.currency ?? data.candidate.currency,
        asOf: priceRecord.observationDate ?? priceRecord.retrievedAt.toISOString(),
        sourceUrl: priceRecord.sourceUrl,
      } } : {}),
    };
    const [scenario] = await db.insert(valuationScenarios).values({
      ownerId: session.auth.userId,
      candidateId: data.candidate.id,
      analysisId: data.candidate.analysisId,
      method: result.method,
      status: 'source_complete',
      assumptionsJson: assumptions,
      resultJson: result,
      sourceReferences: [...references, ...(priceRecord ? [`price:${priceRecord.id}`] : []), `valuation:${compsScenario!.id}`, ...compsScenario!.sourceReferences],
      approvedBy: session.auth.email,
    }).returning();
    return NextResponse.json({ scenario, result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
