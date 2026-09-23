import { QuantError } from './types';

export interface DcfAssumptions {
  currency: string;
  startingFreeCashFlow: number;
  forecastYears: number;
  annualGrowthRate: number;
  discountRate: number;
  terminalGrowthRate: number;
  netDebt: number;
  sharesOutstanding: number;
  dataAsOf: string;
  sourceReferences: string[];
}

export interface DcfProjection {
  year: number;
  freeCashFlow: number;
  discountFactor: number;
  presentValue: number;
}

export interface DcfSensitivityCell {
  discountRate: number;
  terminalGrowthRate: number;
  fairValuePerShare: number | null;
}

export interface DcfResult {
  method: 'two_stage_fcff';
  currency: string;
  projections: DcfProjection[];
  terminalValue: number;
  terminalPresentValue: number;
  enterpriseValue: number;
  equityValue: number;
  fairValuePerShare: number;
  sensitivity: DcfSensitivityCell[];
  assumptions: DcfAssumptions;
  methodology: string;
  caveats: string[];
  computedAt: string;
}

export type DcfScenarioName = 'worst_case' | 'base_case' | 'optimistic_case';

/**
 * A complete three-case valuation. The engine receives every driver as a
 * source-backed record; it deliberately does not manufacture a "reasonable"
 * WACC, growth rate, or terminal rate when evidence is absent.
 */
export interface ThreeCaseDcfResult {
  method: 'three_case_two_stage_fcff';
  currency: string;
  scenarios: Array<{
    name: DcfScenarioName;
    label: 'Worst case' | 'Base case' | 'Optimistic case';
    result: DcfResult;
  }>;
  methodology: string;
  caveats: string[];
  computedAt: string;
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new QuantError(`DCF ${name} must be finite`);
}

export function validateDcfAssumptions(input: DcfAssumptions): void {
  for (const [name, value] of Object.entries({
    startingFreeCashFlow: input.startingFreeCashFlow,
    forecastYears: input.forecastYears,
    annualGrowthRate: input.annualGrowthRate,
    discountRate: input.discountRate,
    terminalGrowthRate: input.terminalGrowthRate,
    netDebt: input.netDebt,
    sharesOutstanding: input.sharesOutstanding,
  })) assertFinite(name, value);
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new QuantError('DCF currency must be an ISO 4217 code');
  if (input.startingFreeCashFlow <= 0) throw new QuantError('DCF starting free cash flow must be positive');
  if (!Number.isInteger(input.forecastYears) || input.forecastYears < 1 || input.forecastYears > 10) {
    throw new QuantError('DCF forecast years must be an integer from 1 to 10');
  }
  if (input.annualGrowthRate < -0.5 || input.annualGrowthRate > 0.5) {
    throw new QuantError('DCF annual growth rate must be between -50% and 50%');
  }
  if (input.discountRate <= 0 || input.discountRate > 0.5) {
    throw new QuantError('DCF discount rate must be greater than 0% and no more than 50%');
  }
  if (input.terminalGrowthRate < -0.05 || input.terminalGrowthRate > 0.05) {
    throw new QuantError('DCF terminal growth rate must be between -5% and 5%');
  }
  if (input.discountRate <= input.terminalGrowthRate) {
    throw new QuantError('DCF discount rate must exceed terminal growth rate');
  }
  if (input.sharesOutstanding <= 0) throw new QuantError('DCF shares outstanding must be positive');
  if (!Number.isFinite(Date.parse(input.dataAsOf))) throw new QuantError('DCF dataAsOf must be an ISO timestamp');
  if (input.sourceReferences.length === 0 || input.sourceReferences.some((reference) => !reference.trim())) {
    throw new QuantError('DCF requires at least one non-empty source reference');
  }
}

function fairValueAt(input: DcfAssumptions, discountRate: number, terminalGrowthRate: number): number | null {
  if (discountRate <= terminalGrowthRate || discountRate <= 0) return null;
  let freeCashFlow = input.startingFreeCashFlow;
  let presentValue = 0;
  for (let year = 1; year <= input.forecastYears; year += 1) {
    freeCashFlow *= 1 + input.annualGrowthRate;
    presentValue += freeCashFlow / (1 + discountRate) ** year;
  }
  const terminalValue = freeCashFlow * (1 + terminalGrowthRate) / (discountRate - terminalGrowthRate);
  const enterpriseValue = presentValue + terminalValue / (1 + discountRate) ** input.forecastYears;
  const result = (enterpriseValue - input.netDebt) / input.sharesOutstanding;
  return Number.isFinite(result) ? result : null;
}

export function discountedCashFlow(input: DcfAssumptions): DcfResult {
  validateDcfAssumptions(input);
  const projections: DcfProjection[] = [];
  let freeCashFlow = input.startingFreeCashFlow;
  let projectedPresentValue = 0;
  for (let year = 1; year <= input.forecastYears; year += 1) {
    freeCashFlow *= 1 + input.annualGrowthRate;
    const discountFactor = 1 / (1 + input.discountRate) ** year;
    const presentValue = freeCashFlow * discountFactor;
    projectedPresentValue += presentValue;
    projections.push({ year, freeCashFlow, discountFactor, presentValue });
  }
  const terminalValue = freeCashFlow * (1 + input.terminalGrowthRate) /
    (input.discountRate - input.terminalGrowthRate);
  const terminalPresentValue = terminalValue / (1 + input.discountRate) ** input.forecastYears;
  const enterpriseValue = projectedPresentValue + terminalPresentValue;
  const equityValue = enterpriseValue - input.netDebt;
  const fairValuePerShare = equityValue / input.sharesOutstanding;

  const sensitivity: DcfSensitivityCell[] = [];
  for (const discountDelta of [-0.02, -0.01, 0, 0.01, 0.02]) {
    for (const terminalDelta of [-0.01, -0.005, 0, 0.005, 0.01]) {
      const discountRate = input.discountRate + discountDelta;
      const terminalGrowthRate = input.terminalGrowthRate + terminalDelta;
      sensitivity.push({
        discountRate,
        terminalGrowthRate,
        fairValuePerShare: fairValueAt(input, discountRate, terminalGrowthRate),
      });
    }
  }

  const caveats = [
    'DCF is assumption-sensitive and is not a market-price prediction.',
    'The model uses one explicit growth stage followed by a perpetual-growth terminal value.',
    'All assumptions require human confirmation; no LLM arithmetic enters this result.',
  ];
  if (terminalPresentValue / enterpriseValue > 0.75) {
    caveats.push('More than 75% of enterprise value comes from the terminal value.');
  }

  return {
    method: 'two_stage_fcff',
    currency: input.currency,
    projections,
    terminalValue,
    terminalPresentValue,
    enterpriseValue,
    equityValue,
    fairValuePerShare,
    sensitivity,
    assumptions: input,
    methodology: `Two-stage FCFF DCF: ${input.forecastYears} explicit annual periods, present values discounted at ${(input.discountRate * 100).toFixed(2)}%, Gordon-growth terminal value at ${(input.terminalGrowthRate * 100).toFixed(2)}%, then net debt removed and shares outstanding applied.`,
    caveats,
    computedAt: new Date().toISOString(),
  };
}

export function threeCaseDiscountedCashFlow(input: Record<DcfScenarioName, DcfAssumptions>): ThreeCaseDcfResult {
  const ordered: Array<[DcfScenarioName, 'Worst case' | 'Base case' | 'Optimistic case']> = [
    ['worst_case', 'Worst case'],
    ['base_case', 'Base case'],
    ['optimistic_case', 'Optimistic case'],
  ];
  const scenarios = ordered.map(([name, label]) => ({ name, label, result: discountedCashFlow(input[name]) }));
  const base = scenarios[1]!.result;
  const currency = base.currency;
  if (scenarios.some(({ result }) => result.currency !== currency)) {
    throw new QuantError('All DCF scenarios must use the same currency');
  }
  const [worst, , optimistic] = scenarios;
  if (worst!.result.fairValuePerShare > base.fairValuePerShare || base.fairValuePerShare > optimistic!.result.fairValuePerShare) {
    throw new QuantError('Scenario drivers must produce worst-case ≤ base-case ≤ optimistic-case value per share');
  }
  return {
    method: 'three_case_two_stage_fcff',
    currency,
    scenarios,
    methodology: 'Three-case two-stage FCFF DCF. Each case is independently calculated from source-linked inputs; no LLM arithmetic or unsourced default assumption is used.',
    caveats: [
      'This is an assumption-sensitive analytical model, not a market-price prediction or a trade instruction.',
      'The model is generated only when every financial and scenario driver is present in the retained evidence record.',
      ...base.caveats,
    ],
    computedAt: new Date().toISOString(),
  };
}

export function assessDcfSuitability(sector: string | null, availableFields: Iterable<string>) {
  const normalized = (sector ?? '').toLowerCase();
  const methodMismatch = /bank|financial|insurance|reit|real estate/.test(normalized);
  const available = new Set(availableFields);
  const missing = ['free_cash_flow', 'total_debt', 'cash_and_equivalents', 'shares_outstanding']
    .filter((field) => !available.has(field));
  return {
    status: methodMismatch ? 'alternative_method_recommended' as const
      : missing.length ? 'insufficient_data' as const
      : 'review_required' as const,
    missingFields: missing,
    rationale: methodMismatch
      ? 'A standard FCFF DCF is often a poor fit for financial institutions and real-estate vehicles; select and review an appropriate alternative before valuation.'
      : missing.length
        ? `DCF cannot be initialized until these source fields are available: ${missing.join(', ')}.`
        : 'Required source fields are present, but growth and discount assumptions still require human review.',
  };
}
