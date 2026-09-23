import { QuantError } from './types';

export interface IntegratedPeer {
  id: string;
  companyName: string;
  ticker: string;
  currency: string;
  sharePrice: number;
  dilutedShares: number;
  totalDebt: number;
  cash: number;
  revenue: number;
  ebitda: number;
  netIncome: number;
  included: boolean;
}

export interface IntegratedDcfInput {
  riskFreeRate: number;
  marketRiskPremium: number;
  beta: number;
  costOfDebt: number;
  taxRate: number;
  debtToCapital: number;
  baseRevenue: number;
  baseEbitdaMargin: number;
  daPercent: number;
  capexPercent: number;
  nwcPercent: number;
  revenueGrowth: number[];
  ebitdaMargin: number[];
  capexPercentForecast: number[];
  nwcPercentForecast: number[];
  perpetuityGrowthRate: number;
  exitMultiple: number;
  targetDebt: number;
  targetCash: number;
  dilutedShares: number;
  targetNetIncome: number;
}

export interface IntegratedPeerResult extends IntegratedPeer {
  equityValue: number;
  enterpriseValue: number;
  evRevenue: number | null;
  evEbitda: number | null;
  pe: number | null;
}

export interface IntegratedDcfResult {
  costOfEquity: number;
  afterTaxCostOfDebt: number;
  wacc: number;
  baseYear: { revenue: number; ebitda: number; ebit: number; taxes: number; ebiat: number; da: number; capex: number; changeNwc: number; ufcf: number };
  projections: Array<{ year: number; revenue: number; ebitda: number; ebit: number; taxes: number; ebiat: number; da: number; capex: number; changeNwc: number; ufcf: number; discountFactor: number; presentValue: number }>;
  perpetuityTerminalValue: number | null;
  exitTerminalValue: number | null;
  perpetuityEnterpriseValue: number | null;
  exitEnterpriseValue: number | null;
  perpetuityPerShare: number | null;
  exitPerShare: number | null;
  sensitivities: Array<{ wacc: number; growth: number; exitMultiple: number; perpetuityPerShare: number | null; exitPerShare: number | null }>;
}

function requireFinite(input: IntegratedDcfInput): void {
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new QuantError(`${key} must be finite`);
    if (Array.isArray(value) && value.some((item) => !Number.isFinite(item))) throw new QuantError(`${key} values must be finite`);
  }
  if (input.revenueGrowth.length !== 5 || input.ebitdaMargin.length !== 5 || input.capexPercentForecast.length !== 5 || input.nwcPercentForecast.length !== 5) {
    throw new QuantError('Integrated DCF requires exactly five annual operating assumptions');
  }
  if (input.baseRevenue <= 0 || input.dilutedShares <= 0) throw new QuantError('Revenue and diluted shares must be positive');
  if (input.debtToCapital < 0 || input.debtToCapital > 1 || input.taxRate < 0 || input.taxRate > 1) throw new QuantError('Capital structure and tax rates must be between 0% and 100%');
}

export function calculateIntegratedComps(peers: IntegratedPeer[]) {
  const rows: IntegratedPeerResult[] = peers.map((peer) => {
    const equityValue = peer.sharePrice * peer.dilutedShares;
    const enterpriseValue = equityValue + peer.totalDebt - peer.cash;
    return {
      ...peer,
      equityValue,
      enterpriseValue,
      evRevenue: peer.revenue > 0 ? enterpriseValue / peer.revenue : null,
      evEbitda: peer.ebitda > 0 ? enterpriseValue / peer.ebitda : null,
      pe: peer.netIncome > 0 ? equityValue / peer.netIncome : null,
    };
  });
  const included = rows.filter((peer) => peer.included);
  const stats = (values: Array<number | null>) => {
    const sorted = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
    const median = sorted.length === 0 ? null : sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]!
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
    return { count: sorted.length, mean: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null, median, low: sorted[0] ?? null, high: sorted.at(-1) ?? null };
  };
  return {
    rows,
    includedCount: included.length,
    evRevenue: stats(included.map((peer) => peer.evRevenue)),
    evEbitda: stats(included.map((peer) => peer.evEbitda)),
    pe: stats(included.map((peer) => peer.pe)),
  };
}

export function calculateIntegratedDcf(input: IntegratedDcfInput, medianEvEbitda: number | null, useCompsMedian = medianEvEbitda != null): IntegratedDcfResult {
  requireFinite(input);
  const equityWeight = 1 - input.debtToCapital;
  const costOfEquity = input.riskFreeRate + input.beta * input.marketRiskPremium;
  const afterTaxCostOfDebt = input.costOfDebt * (1 - input.taxRate);
  const wacc = costOfEquity * equityWeight + afterTaxCostOfDebt * input.debtToCapital;
  const validDiscountRate = wacc > 0;
  const exitMultiple = useCompsMedian ? medianEvEbitda : input.exitMultiple;
  const baseEbitda = input.baseRevenue * input.baseEbitdaMargin;
  const baseDa = input.baseRevenue * input.daPercent;
  const baseEbit = baseEbitda - baseDa;
  const baseTaxes = Math.max(0, baseEbit) * input.taxRate;
  const baseYear = {
    revenue: input.baseRevenue,
    ebitda: baseEbitda,
    ebit: baseEbit,
    taxes: baseTaxes,
    ebiat: baseEbit - baseTaxes,
    da: baseDa,
    capex: input.baseRevenue * input.capexPercent,
    changeNwc: input.baseRevenue * input.nwcPercent,
    ufcf: baseEbit - baseTaxes + baseDa - input.baseRevenue * input.capexPercent - input.baseRevenue * input.nwcPercent,
  };
  let revenue = input.baseRevenue;
  const projections: IntegratedDcfResult['projections'] = input.revenueGrowth.map((growth, index) => {
    revenue *= 1 + growth;
    const ebitda = revenue * input.ebitdaMargin[index]!;
    const da = revenue * input.daPercent;
    const ebit = ebitda - da;
    const taxes = Math.max(0, ebit) * input.taxRate;
    const ebiat = ebit - taxes;
    const capex = revenue * input.capexPercentForecast[index]!;
    const changeNwc = revenue * input.nwcPercentForecast[index]!;
    const ufcf = ebiat + da - capex - changeNwc;
    const discountFactor = validDiscountRate ? 1 / (1 + wacc) ** (index + 1) : Number.NaN;
    return { year: index + 1, revenue, ebitda, ebit, taxes, ebiat, da, capex, changeNwc, ufcf, discountFactor, presentValue: ufcf * discountFactor };
  });
  const pvFcfs = projections.reduce((sum, row) => sum + row.presentValue, 0);
  const last = projections.at(-1)!;
  const perpetuityTerminalValue = validDiscountRate && wacc > input.perpetuityGrowthRate
    ? last.ufcf * (1 + input.perpetuityGrowthRate) / (wacc - input.perpetuityGrowthRate) : null;
  const exitTerminalValue = exitMultiple != null && exitMultiple >= 0 ? last.ebitda * exitMultiple : null;
  const bridgeToShare = (terminalValue: number | null) => terminalValue == null || input.dilutedShares <= 0
    ? { enterpriseValue: null, perShare: null }
    : { enterpriseValue: pvFcfs + terminalValue / (1 + wacc) ** 5, perShare: (pvFcfs + terminalValue / (1 + wacc) ** 5 - input.targetDebt + input.targetCash) / input.dilutedShares };
  const perpetuity = bridgeToShare(perpetuityTerminalValue);
  const exit = bridgeToShare(exitTerminalValue);
  const sensitivityBaseMultiple = exitMultiple ?? input.exitMultiple;
  const sensitivities = [-0.01, -0.005, 0, 0.005, 0.01].flatMap((waccDelta) => [-0.005, -0.0025, 0, 0.0025, 0.005].flatMap((growthDelta) => [-2, -1, 0, 1, 2].map((multipleDelta) => {
    const sensitivityWacc = wacc + waccDelta;
    const growthRate = input.perpetuityGrowthRate + growthDelta;
    const growthTerminal = sensitivityWacc > growthRate ? last.ufcf * (1 + growthRate) / (sensitivityWacc - growthRate) : null;
    const sensitivityMultiple = useCompsMedian && exitMultiple == null ? null : Math.max(0, sensitivityBaseMultiple + multipleDelta);
    const multipleTerminal = sensitivityMultiple == null ? null : sensitivityMultiple * last.ebitda;
    const pvAtRate = sensitivityWacc > 0 ? projections.reduce((sum, row) => sum + row.ufcf / (1 + sensitivityWacc) ** row.year, 0) : Number.NaN;
    const perShare = (terminal: number | null) => terminal == null || sensitivityWacc <= 0 ? null
      : (pvAtRate + terminal / (1 + sensitivityWacc) ** 5 - input.targetDebt + input.targetCash) / input.dilutedShares;
    return { wacc: sensitivityWacc, growth: growthRate, exitMultiple: sensitivityMultiple ?? 0, perpetuityPerShare: perShare(growthTerminal), exitPerShare: perShare(multipleTerminal) };
  })));
  return {
    costOfEquity,
    afterTaxCostOfDebt,
    wacc,
    baseYear,
    projections,
    perpetuityTerminalValue,
    exitTerminalValue,
    perpetuityEnterpriseValue: perpetuity.enterpriseValue,
    exitEnterpriseValue: exit.enterpriseValue,
    perpetuityPerShare: perpetuity.perShare,
    exitPerShare: exit.perShare,
    sensitivities,
  };
}
