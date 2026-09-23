'use client';

import { useEffect, useRef, useState } from 'react';

interface ValuationSetup {
  suitability: {
    status: 'alternative_method_recommended' | 'insufficient_data' | 'review_required';
    rationale: string;
    missingFields: string[];
  };
  defaults: {
    startingFreeCashFlow: number | null;
    netDebt: number | null;
    sharesOutstanding: number | null;
    forecastYears: number;
    annualGrowthRate: number | null;
    discountRate: number | null;
    terminalGrowthRate: number | null;
    currency: string;
    dataAsOf: string | null;
    sourceReferences: string[];
    currentPrice: { value: number; currency: string; asOf: string; sourceUrl: string | null } | null;
  };
  automaticReadiness: {
    ready: boolean;
    missingFinancialRecords: string[];
    missingScenarioDrivers: string[];
    missingWaccRecords: string[];
    waccError: string | null;
    missingComparableAnalysis: boolean;
    staleComparableAnalysis: boolean;
    message: string;
  };
  latestScenario: { id: string; method: string; resultJson: ThreeCaseDcfResult } | null;
  costOfCapital: { riskFreeRate: number; marketRiskPremium: number; beta: number; costOfDebt: number; taxRate: number; debtToCapital: number; costOfEquity: number; afterTaxCostOfDebt: number; wacc: number } | null;
}

interface ThreeCaseDcfResult {
  method: 'three_case_two_stage_fcff';
  currency: string;
  scenarios: Array<{
    name: 'worst_case' | 'base_case' | 'optimistic_case';
    label: string;
    result: DcfResult;
  }>;
  methodology: string;
  caveats: string[];
  computedAt: string;
  currentPrice?: { value: number; currency: string; asOf: string; sourceUrl: string | null };
  comparableCompanies?: {
    scenarioId: string;
    sourceReferences: string[];
    result: ComparableResult;
  };
}

interface DcfResult {
  currency: string;
  fairValuePerShare: number;
  enterpriseValue: number;
  equityValue: number;
  projections: Array<{ year: number; freeCashFlow: number; discountFactor: number; presentValue: number }>;
  methodology: string;
  caveats: string[];
  assumptions: {
    annualGrowthRate: number;
    discountRate: number;
    terminalGrowthRate: number;
  };
  exitMultipleValuation?: {
    multiple: number;
    terminalEbitda: number;
    fairValuePerShare: number;
    sensitivity: Array<{ discountRate: number; exitMultiple: number; fairValuePerShare: number | null }>;
  };
  sensitivity: Array<{
    discountRate: number;
    terminalGrowthRate: number;
    fairValuePerShare: number | null;
  }>;
}

interface ComparableSetup {
  target: {
    companyName: string;
    currency: string;
    revenue?: number;
    ebitda?: number;
    netIncome?: number;
    netDebt?: number;
    sharesOutstanding?: number;
  };
  dataAsOf: string | null;
  missing: string[];
  latestScenario: { resultJson: ComparableResult } | null;
}

interface ComparableResult {
  currency: string;
  target: { companyName: string; currency: string; revenue?: number; ebitda?: number; netIncome?: number; netDebt?: number; sharesOutstanding?: number };
  peers: Array<{ companyName: string; ticker: string; currency: string; sourceUrl: string; enterpriseValue: number; evRevenue: number | null; evEbitda: number | null; pe: number | null; evNtmRevenue: number | null; evNtmEbitda: number | null; ntmPe: number | null; ebitdaMargin: number | null; netMargin: number | null; ntmRevenueGrowth: number | null; ntmEbitdaGrowth: number | null; netDebtEbitda: number | null; grossMargin: number | null; operatingMargin: number | null; returnOnEquity: number | null; priceToBook: number | null; interestCoverage: number | null; debtToEquity: number | null; roic: number | null; outlierMultiples: string[] }>;
  statistics: Record<'evRevenue' | 'evEbitda' | 'pe' | 'evNtmRevenue' | 'evNtmEbitda' | 'ntmPe', { count: number; low: number | null; high: number | null; mean: number | null; median: number | null; percentile25: number | null; percentile75: number | null }>;
  impliedValuations: Array<{ multiple: string; statistic: string; multipleValue: number; impliedEnterpriseValue: number | null; impliedEquityValue: number | null; impliedValuePerShare: number | null }>;
  methodology: string;
  caveats: string[];
}

interface PeerForm {
  included: boolean;
  companyName: string;
  ticker: string;
  exchange: string;
  currency: string;
  marketCapitalization: string;
  netDebt: string;
  totalDebt: string;
  revenue: string;
  ebitda: string;
  netIncome: string;
  grossProfit: string;
  operatingIncome: string;
  totalEquity: string;
  interestExpense: string;
  cashAndEquivalents: string;
  incomeTaxExpense: string;
  preTaxIncome: string;
  ntmRevenue: string;
  ntmEbitda: string;
  ntmNetIncome: string;
  sourceUrl: string;
  forecastSourceUrl: string;
  researchNote: string;
}

interface PeerResearchResponse {
  companyName?: string;
  ticker?: string;
  exchange?: string;
  currency?: string;
  marketCapitalization?: number;
  netDebt?: number;
  totalDebt?: number;
  revenue?: number;
  ebitda?: number;
  netIncome?: number;
  grossProfit?: number;
  operatingIncome?: number;
  totalEquity?: number;
  interestExpense?: number;
  cashAndEquivalents?: number;
  incomeTaxExpense?: number;
  preTaxIncome?: number;
  ntmRevenue?: number;
  ntmEbitda?: number;
  ntmNetIncome?: number;
  sourceUrl?: string;
  forecastSourceUrl?: string;
  evidence?: string[];
  gaps?: string[];
}

interface SummaryRange { label: string; low: number; mid: number; high: number; }

function FootballField({ range, min, max, currency }: { range: SummaryRange; min: number; max: number; currency: string }) {
  const span = Math.max(max - min, 1e-9);
  const left = Math.max(0, Math.min(100, ((range.low - min) / span) * 100));
  const right = Math.max(left, Math.min(100, ((range.high - min) / span) * 100));
  const middle = Math.max(0, Math.min(100, ((range.mid - min) / span) * 100));
  const format = (value: number) => `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return <div className="sourced-football-row" aria-label={`${range.label}: ${format(range.low)} to ${format(range.high)}, midpoint ${format(range.mid)}`}>
    <div><strong>{range.label}</strong><span>{format(range.low)} — {format(range.high)}</span></div>
    <div className="sourced-football-track"><i style={{ left: `${left}%`, width: `${Math.max(right - left, 0.6)}%` }} /><b style={{ left: `${middle}%` }} /></div>
  </div>;
}

function summaryRanges(dcf: ThreeCaseDcfResult | null, comps: ComparableResult | null, currentPrice: ValuationSetup['defaults']['currentPrice'], targetCurrency: string): SummaryRange[] {
  const ranges: SummaryRange[] = [];
  if (dcf) {
    const byCase = (field: 'perpetuity' | 'exit') => dcf.scenarios.map(({ result }) => field === 'perpetuity'
      ? result.fairValuePerShare : result.exitMultipleValuation?.fairValuePerShare).filter((value): value is number => value != null && Number.isFinite(value));
    for (const [label, field] of [['DCF · Perpetuity growth', 'perpetuity'], ['DCF · Comps exit multiple', 'exit']] as const) {
      const values = byCase(field);
      if (values.length) ranges.push({ label, low: Math.min(...values), mid: values[1] ?? values[0]!, high: Math.max(...values) });
    }
  }
  if (comps) {
    const { target, statistics } = comps;
    const addMultipleRange = (label: string, stats: MultipleStatistics | undefined, denominator: number | undefined, enterpriseMultiple: boolean) => {
      if (!stats || denominator == null || denominator <= 0 || target.sharesOutstanding == null || target.sharesOutstanding <= 0) return;
      const netDebt = enterpriseMultiple ? target.netDebt : 0;
      if (enterpriseMultiple && netDebt == null) return;
      const perShare = (multiple: number | null) => multiple == null ? null : (multiple * denominator - (netDebt ?? 0)) / target.sharesOutstanding!;
      const low = perShare(stats.percentile25), mid = perShare(stats.median), high = perShare(stats.percentile75);
      if (low != null && mid != null && high != null) ranges.push({ label, low: Math.min(low, high), mid, high: Math.max(low, high) });
    };
    addMultipleRange('Comps · EV / EBITDA', statistics.evEbitda, target.ebitda, true);
    addMultipleRange('Comps · P / E', statistics.pe, target.netIncome, false);
  }
  if (currentPrice && currentPrice.currency === targetCurrency && Number.isFinite(currentPrice.value)) ranges.push({ label: 'Current share price', low: currentPrice.value, mid: currentPrice.value, high: currentPrice.value });
  return ranges;
}

interface MultipleStatistics {
  count: number;
  low: number | null;
  high: number | null;
  mean: number | null;
  median: number | null;
  percentile25: number | null;
  percentile75: number | null;
}

function emptyPeer(): PeerForm {
  return { included: true, companyName: '', ticker: '', exchange: '', currency: '', marketCapitalization: '', netDebt: '', totalDebt: '', revenue: '', ebitda: '', netIncome: '', grossProfit: '', operatingIncome: '', totalEquity: '', interestExpense: '', cashAndEquivalents: '', incomeTaxExpense: '', preTaxIncome: '', ntmRevenue: '', ntmEbitda: '', ntmNetIncome: '', sourceUrl: '', forecastSourceUrl: '', researchNote: '' };
}

export function ValuationWorkbench({ candidateId, onSaved }: { candidateId: string; onSaved: () => void }) {
  const [activeTab, setActiveTab] = useState<'summary' | 'comps' | 'dcf' | 'sensitivity'>('summary');
  const [setup, setSetup] = useState<ValuationSetup | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [automaticResult, setAutomaticResult] = useState<ThreeCaseDcfResult | null>(null);
  const [automaticScenarioId, setAutomaticScenarioId] = useState<string | null>(null);
  const [compsSetup, setCompsSetup] = useState<ComparableSetup | null>(null);
  const [peers, setPeers] = useState<PeerForm[]>(() => Array.from({ length: 6 }, emptyPeer));
  const [compsResult, setCompsResult] = useState<ComparableResult | null>(null);
  const [compsBusy, setCompsBusy] = useState(true);
  const [compsError, setCompsError] = useState<string | null>(null);
  const [primarySourceBusy, setPrimarySourceBusy] = useState(false);
  const [primarySourceNotice, setPrimarySourceNotice] = useState<string | null>(null);
  const [peerSuggestionNotice, setPeerSuggestionNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const automaticPeerResearchKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError(null);
    setAutomaticResult(null);
    setAutomaticScenarioId(null);
    fetch(`/api/discovery/valuations?candidateId=${encodeURIComponent(candidateId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ValuationSetup & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `Valuation setup failed (${response.status})`);
        setSetup(body);
        if (body.latestScenario?.method === 'three_case_two_stage_fcff') {
          setAutomaticResult(body.latestScenario.resultJson);
          setAutomaticScenarioId(body.latestScenario.id);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [candidateId, reloadToken]);

  useEffect(() => {
    const controller = new AbortController();
    setCompsBusy(true);
    setCompsError(null);
    fetch(`/api/discovery/comparables?candidateId=${encodeURIComponent(candidateId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ComparableSetup & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `Comparable-company setup failed (${response.status})`);
        setCompsSetup(body);
        setCompsResult(body.latestScenario?.resultJson ?? null);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setCompsError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCompsBusy(false);
      });
    return () => controller.abort();
  }, [candidateId, reloadToken]);

  async function generateAutomaticDcf() {
    if (!setup) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/discovery/valuations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId, automatic: true }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; result?: ThreeCaseDcfResult; scenario?: { id: string } };
      if (!response.ok || !body.result) throw new Error(body.error ?? `DCF failed (${response.status})`);
      setAutomaticResult(body.result);
      setAutomaticScenarioId(body.scenario?.id ?? null);
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updatePeer(index: number, key: keyof PeerForm, value: string | boolean) {
    setPeers((current) => current.map((peer, peerIndex) => peerIndex === index ? { ...peer, [key]: value } : peer));
  }

  async function calculateComps() {
    setCompsBusy(true);
    setCompsError(null);
    try {
      const response = await fetch('/api/discovery/comparables', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          candidateId,
          methodSuitabilityConfirmed: true,
          peers: peers.filter((peer) => peer.included).map((peer) => ({
            companyName: peer.companyName,
            ticker: peer.ticker,
            currency: peer.currency.toUpperCase(),
            marketCapitalization: Number(peer.marketCapitalization),
            netDebt: Number(peer.netDebt),
            totalDebt: peer.totalDebt === '' ? undefined : Number(peer.totalDebt),
            revenue: peer.revenue === '' ? undefined : Number(peer.revenue),
            ebitda: peer.ebitda === '' ? undefined : Number(peer.ebitda),
            netIncome: peer.netIncome === '' ? undefined : Number(peer.netIncome),
            grossProfit: peer.grossProfit === '' ? undefined : Number(peer.grossProfit),
            operatingIncome: peer.operatingIncome === '' ? undefined : Number(peer.operatingIncome),
            totalEquity: peer.totalEquity === '' ? undefined : Number(peer.totalEquity),
            interestExpense: peer.interestExpense === '' ? undefined : Number(peer.interestExpense),
            cashAndEquivalents: peer.cashAndEquivalents === '' ? undefined : Number(peer.cashAndEquivalents),
            incomeTaxExpense: peer.incomeTaxExpense === '' ? undefined : Number(peer.incomeTaxExpense),
            preTaxIncome: peer.preTaxIncome === '' ? undefined : Number(peer.preTaxIncome),
            ntmRevenue: peer.ntmRevenue === '' ? undefined : Number(peer.ntmRevenue),
            ntmEbitda: peer.ntmEbitda === '' ? undefined : Number(peer.ntmEbitda),
            ntmNetIncome: peer.ntmNetIncome === '' ? undefined : Number(peer.ntmNetIncome),
            sourceUrl: peer.sourceUrl,
            forecastSourceUrl: peer.forecastSourceUrl === '' ? undefined : peer.forecastSourceUrl,
          })),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; result?: ComparableResult };
      if (!response.ok || !body.result) throw new Error(body.error ?? `Comparable-company analysis failed (${response.status})`);
      setCompsResult(body.result);
      onSaved();
    } catch (cause) {
      setCompsError((cause as Error).message);
    } finally {
      setCompsBusy(false);
    }
  }

  async function researchPeers() {
    setCompsBusy(true);
    setCompsError(null);
    try {
      const identities = peers.map((peer) => ({ companyName: peer.companyName, ticker: peer.ticker, exchange: peer.exchange, currency: peer.currency }));
      if (identities.some((peer) => !peer.companyName || !peer.ticker || !peer.exchange || !peer.currency)) {
        throw new Error('Enter company name, ticker, exchange, and currency for each of the 6–10 peers before researching them.');
      }
      const response = await fetch('/api/discovery/comparables/research', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId, peers: identities }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; peers?: PeerResearchResponse[] };
      if (!response.ok || !body.peers) throw new Error(body.error ?? `Peer research failed (${response.status})`);
      setPeers((current) => current.map((peer, index) => {
        const found = body.peers?.[index];
        if (!found) return peer;
        return {
          ...peer,
          marketCapitalization: found.marketCapitalization == null ? peer.marketCapitalization : String(found.marketCapitalization),
          netDebt: found.netDebt == null ? peer.netDebt : String(found.netDebt),
          totalDebt: found.totalDebt == null ? peer.totalDebt : String(found.totalDebt),
          revenue: found.revenue == null ? peer.revenue : String(found.revenue),
          ebitda: found.ebitda == null ? peer.ebitda : String(found.ebitda),
          netIncome: found.netIncome == null ? peer.netIncome : String(found.netIncome),
          grossProfit: found.grossProfit == null ? peer.grossProfit : String(found.grossProfit),
          operatingIncome: found.operatingIncome == null ? peer.operatingIncome : String(found.operatingIncome),
          totalEquity: found.totalEquity == null ? peer.totalEquity : String(found.totalEquity),
          interestExpense: found.interestExpense == null ? peer.interestExpense : String(found.interestExpense),
          cashAndEquivalents: found.cashAndEquivalents == null ? peer.cashAndEquivalents : String(found.cashAndEquivalents),
          incomeTaxExpense: found.incomeTaxExpense == null ? peer.incomeTaxExpense : String(found.incomeTaxExpense),
          preTaxIncome: found.preTaxIncome == null ? peer.preTaxIncome : String(found.preTaxIncome),
          ntmRevenue: found.ntmRevenue == null ? peer.ntmRevenue : String(found.ntmRevenue),
          ntmEbitda: found.ntmEbitda == null ? peer.ntmEbitda : String(found.ntmEbitda),
          ntmNetIncome: found.ntmNetIncome == null ? peer.ntmNetIncome : String(found.ntmNetIncome),
          sourceUrl: found.sourceUrl ?? peer.sourceUrl,
          forecastSourceUrl: found.forecastSourceUrl ?? peer.forecastSourceUrl,
          researchNote: [...(found.evidence ?? []), ...(found.gaps ?? [])].join(' '),
        };
      }));
    } catch (cause) { setCompsError((cause as Error).message); }
    finally { setCompsBusy(false); }
  }

  async function suggestPeers() {
    setCompsBusy(true);
    setCompsError(null);
    setPeerSuggestionNotice(null);
    try {
      const response = await fetch('/api/discovery/comparables/suggestions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; peers?: Array<{ companyName: string; ticker: string; exchange: string; currency: string; sourceUrl: string; rationale: string }> };
      if (!response.ok || !body.peers) throw new Error(body.error ?? `Peer discovery failed (${response.status})`);
      if (body.peers.length === 0) {
        setPeerSuggestionNotice('No sufficiently identified public peers were found. Add peer identities manually; the system can still research and prefill their data.');
        return;
      }
      setPeers(body.peers.slice(0, 10).map((peer) => ({ ...emptyPeer(), ...peer, researchNote: peer.rationale })));
      setPeerSuggestionNotice(`${body.peers.length} publicly identified peer suggestions were added. Review the selection rationale before researching their financial data.`);
    } catch (cause) { setCompsError((cause as Error).message); }
    finally { setCompsBusy(false); }
  }

  useEffect(() => {
    if (!compsSetup || compsResult || automaticPeerResearchKey.current === candidateId) return;
    automaticPeerResearchKey.current = candidateId;
    let cancelled = false;
    async function discoverAndPrefillPeers() {
      setCompsBusy(true);
      setCompsError(null);
      try {
        const suggestionResponse = await fetch('/api/discovery/comparables/suggestions', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId }),
        });
        const suggested = await suggestionResponse.json().catch(() => ({})) as { error?: string; peers?: Array<{ companyName: string; ticker: string; exchange: string; currency: string; sourceUrl: string; rationale: string }> };
        if (!suggestionResponse.ok || !suggested.peers) throw new Error(suggested.error ?? 'Peer discovery failed.');
        if (suggested.peers.length < 6) {
          setPeerSuggestionNotice(`Automatic peer research found ${suggested.peers.length} publicly identified peers. Six are required for a comparable valuation, so add the remaining reviewed peers and run the prefill action.`);
          return;
        }
        const selected = suggested.peers.slice(0, 10);
        const researchResponse = await fetch('/api/discovery/comparables/research', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId, peers: selected.map(({ companyName, ticker, exchange, currency }) => ({ companyName, ticker, exchange, currency })) }),
        });
        const researched = await researchResponse.json().catch(() => ({})) as { error?: string; peers?: PeerResearchResponse[] };
        if (!researchResponse.ok || !researched.peers) throw new Error(researched.error ?? 'Peer financial research failed.');
        if (cancelled) return;
        setPeers(selected.map((peer, index) => {
          const found = researched.peers?.[index] ?? {};
          return {
            ...emptyPeer(), ...peer,
            marketCapitalization: found.marketCapitalization == null ? '' : String(found.marketCapitalization),
            netDebt: found.netDebt == null ? '' : String(found.netDebt), totalDebt: found.totalDebt == null ? '' : String(found.totalDebt),
            revenue: found.revenue == null ? '' : String(found.revenue), ebitda: found.ebitda == null ? '' : String(found.ebitda), netIncome: found.netIncome == null ? '' : String(found.netIncome),
            grossProfit: found.grossProfit == null ? '' : String(found.grossProfit), operatingIncome: found.operatingIncome == null ? '' : String(found.operatingIncome), totalEquity: found.totalEquity == null ? '' : String(found.totalEquity), interestExpense: found.interestExpense == null ? '' : String(found.interestExpense),
            cashAndEquivalents: found.cashAndEquivalents == null ? '' : String(found.cashAndEquivalents), incomeTaxExpense: found.incomeTaxExpense == null ? '' : String(found.incomeTaxExpense), preTaxIncome: found.preTaxIncome == null ? '' : String(found.preTaxIncome),
            ntmRevenue: found.ntmRevenue == null ? '' : String(found.ntmRevenue), ntmEbitda: found.ntmEbitda == null ? '' : String(found.ntmEbitda), ntmNetIncome: found.ntmNetIncome == null ? '' : String(found.ntmNetIncome),
            sourceUrl: found.sourceUrl ?? peer.sourceUrl, forecastSourceUrl: found.forecastSourceUrl ?? '',
            researchNote: `${peer.rationale} ${(found.evidence ?? []).join(' ')} ${(found.gaps ?? []).join(' ')}`.trim(),
          };
        }));
        setPeerSuggestionNotice(`${selected.length} peer candidates were found and researched automatically. Review their rationale and evidence before calculating the comparable valuation.`);
      } catch (cause) {
        if (!cancelled) setCompsError((cause as Error).message);
      } finally { if (!cancelled) setCompsBusy(false); }
    }
    void discoverAndPrefillPeers();
    return () => { cancelled = true; };
  }, [candidateId, compsResult, compsSetup]);

  async function retrievePrimarySourceFinancials() {
    setPrimarySourceBusy(true);
    setPrimarySourceNotice(null);
    try {
      const response = await fetch('/api/discovery/investor-relations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; importedMetrics?: string[] };
      if (!response.ok) throw new Error(body.error ?? `Primary-source retrieval failed (${response.status})`);
      setPrimarySourceNotice(`Imported ${body.importedMetrics?.length ?? 0} primary-source metrics. The integrated model runs only when every required financial, WACC, scenario, and Comps record is available.`);
      setReloadToken((current) => current + 1);
    } catch (cause) {
      setPrimarySourceNotice((cause as Error).message);
    } finally {
      setPrimarySourceBusy(false);
    }
  }

  const ranges = summaryRanges(automaticResult, compsResult, setup?.defaults.currentPrice ?? null, compsSetup?.target.currency ?? setup?.defaults.currency ?? '');
  const rangeMin = ranges.length ? Math.min(...ranges.map((range) => range.low)) : 0;
  const rangeMax = ranges.length ? Math.max(...ranges.map((range) => range.high)) : 1;
  const baseCase = automaticResult?.scenarios.find((scenario) => scenario.name === 'base_case')?.result ?? null;
  const baseGrowthSensitivity = baseCase?.sensitivity ?? [];
  const sensitivityWaccs = [...new Set(baseGrowthSensitivity.map((cell) => cell.discountRate))].sort((a, b) => a - b);
  const sensitivityGrowths = [...new Set(baseGrowthSensitivity.map((cell) => cell.terminalGrowthRate))].sort((a, b) => a - b);
  const exitSensitivity = baseCase?.exitMultipleValuation?.sensitivity ?? [];
  const exitSensitivityWaccs = [...new Set(exitSensitivity.map((cell) => cell.discountRate))].sort((a, b) => a - b);
  const exitSensitivityMultiples = [...new Set(exitSensitivity.map((cell) => cell.exitMultiple))].sort((a, b) => a - b);
  const includedPeerCount = peers.filter((peer) => peer.included).length;

  if (busy && !setup && compsBusy && !compsSetup) return <p className="note">Loading valuation evidence…</p>;
  if (!setup && !compsSetup && !busy && !compsBusy) return <p className="login-error" role="alert">{error ?? compsError ?? 'Valuation evidence is unavailable.'}</p>;
  return (
    <section className="valuation-panel">
      <p className="analysis-eyebrow">4. Valuation</p>
      <h3>Valuation workspace</h3>
      <p className="note">One source-backed valuation workflow links the selected company’s financial records, a reviewed peer set, three DCF cases, and both terminal-value methods. Missing drivers stop the integrated calculation; illustrative inputs are not used.</p>
      <div className="sourced-valuation-tabs" role="tablist" aria-label="Integrated valuation views">
        {([['summary', 'Summary'], ['comps', 'Comps'], ['dcf', 'DCF model'], ['sensitivity', 'Sensitivity']] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={activeTab === id} aria-controls="sourced-valuation-panel" className={activeTab === id ? 'active' : ''} key={id} onClick={() => setActiveTab(id)}>{label}</button>)}
      </div>
      {activeTab === 'summary' && <section className="sourced-summary-view" id="sourced-valuation-panel" role="tabpanel" aria-labelledby="sourced-valuation-tab-summary">
        <h4>{compsSetup?.target.companyName ?? 'Selected company'} · sourced valuation summary</h4>
        <p className="note">The range chart uses generated DCF case values and the reviewed Comps quartiles. A market price appears only when a retained price observation exists.</p>
        {setup?.defaults.currentPrice && setup.defaults.currentPrice.currency !== (compsSetup?.target.currency ?? setup.defaults.currency) && <p className="caveat">The latest market-price record is in {setup.defaults.currentPrice.currency}, while the valuation is in {compsSetup?.target.currency ?? setup.defaults.currency}; it is omitted from the common-currency range.</p>}
        {ranges.length ? <div className="sourced-football-field">{ranges.map((range) => <FootballField key={range.label} range={range} min={rangeMin} max={rangeMax} currency={compsSetup?.target.currency ?? setup?.defaults.currency ?? ''} />)}</div> : <p className="caveat">No sourced valuation output is available yet. Complete peer review and every required financial, WACC, and scenario driver before the automatic model can run.</p>}
        {automaticResult && <div className="dcf-scenario-cards">{automaticResult.scenarios.map((scenario) => <article className="dcf-scenario-card" key={scenario.name}><p className="analysis-eyebrow">{scenario.label}</p><p className="big">Perpetuity: {automaticResult.currency} {scenario.result.fairValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p><p className="note">Exit multiple: {scenario.result.exitMultipleValuation ? `${automaticResult.currency} ${scenario.result.exitMultipleValuation.fairValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : 'N/A'}</p></article>)}</div>}
        {automaticResult?.comparableCompanies && <p className="note">Comps median EV/EBITDA {automaticResult.comparableCompanies.result.statistics.evEbitda.median?.toFixed(2) ?? 'N/A'}x · {automaticResult.comparableCompanies.result.statistics.evEbitda.count} usable peers · linked to the exit method only.</p>}
      </section>}
      {activeTab === 'dcf' && <>
      <div className="primary-source-cta">
        <div><strong>Primary-source financials</strong><p>Retrieve available inline-XBRL annual-report or 10-K values from investor-relations or regulatory filing pages. The system retains the filing URL and will only unlock the DCF when required financial records and scenario drivers are sourced.</p></div>
        <button className="secondary-button" type="button" onClick={() => void retrievePrimarySourceFinancials()} disabled={primarySourceBusy}>{primarySourceBusy ? 'Retrieving…' : 'Retrieve financial statements'}</button>
      </div>
      {primarySourceNotice && <p className={primarySourceNotice.startsWith('Imported') ? 'note' : 'caveat'}>{primarySourceNotice}</p>}
      {!setup ? <section className="dcf-unavailable">
        <h4>Strict automatic DCF</h4>
        <p className="caveat">{busy ? 'Checking structured financial-statement evidence…' : error ?? 'DCF cannot be prepared from the current evidence.'}</p>
        <p className="note">This does not block comparable-company analysis. It prevents a DCF from using unsupported cash-flow, debt, or share-count inputs.</p>
      </section> : <>
      <h4>Strict automatic DCF</h4>
      <p className={setup.suitability.status === 'review_required' ? 'note' : 'caveat'}>{setup.suitability.rationale}</p>
      <p className="note">Currency: {setup.defaults.currency} · Financial evidence as of {setup.defaults.dataAsOf ? new Date(setup.defaults.dataAsOf).toLocaleDateString() : 'unknown'}.</p>
      <p className={setup.automaticReadiness.ready ? 'note' : 'caveat'}>{setup.automaticReadiness.message}</p>
      {setup.automaticReadiness.missingFinancialRecords.length > 0 && <p className="caveat">Missing primary-source financial records: {setup.automaticReadiness.missingFinancialRecords.join(', ')}.</p>}
      {setup.automaticReadiness.missingScenarioDrivers.length > 0 && <p className="caveat">Missing source-linked scenario driver records: {setup.automaticReadiness.missingScenarioDrivers.join(', ')}.</p>}
      {setup.automaticReadiness.missingWaccRecords.length > 0 && <p className="caveat">Missing source-linked WACC inputs: {setup.automaticReadiness.missingWaccRecords.join(', ')}.</p>}
      {setup.automaticReadiness.waccError && <p className="caveat">Source-backed WACC inputs do not produce a valid discount rate: {setup.automaticReadiness.waccError}.</p>}
      {setup.automaticReadiness.missingComparableAnalysis && <p className="caveat">Missing a reviewed comparable analysis with at least six valid peer EV/EBITDA multiples. Calculate Comps first; no peer multiple is inferred.</p>}
      {setup.automaticReadiness.staleComparableAnalysis && <p className="caveat">The saved Comps target snapshot or source references no longer match the current financial records. Recalculate Comps before generating the integrated model.</p>}
      {setup.costOfCapital && <p className="note">Sourced WACC: cost of equity {((setup.costOfCapital.costOfEquity) * 100).toFixed(2)}% × equity weight {((1 - setup.costOfCapital.debtToCapital) * 100).toFixed(1)}% + after-tax debt cost {((setup.costOfCapital.afterTaxCostOfDebt) * 100).toFixed(2)}% × debt weight {(setup.costOfCapital.debtToCapital * 100).toFixed(1)}% = WACC {(setup.costOfCapital.wacc * 100).toFixed(2)}%.</p>}
      <p className="note">The model applies retained records to five-year FCFF projections and three independently sourced scenarios. The included-peer median EV/EBITDA is applied only to source-backed Year 5 EBITDA; it does not determine WACC or perpetuity growth.</p>
      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="action-button" type="button" onClick={() => void generateAutomaticDcf()} disabled={busy || !setup.automaticReadiness.ready}>
        {busy ? 'Generating…' : 'Generate integrated sourced model'}
      </button>
      {automaticResult && (
        <div className="valuation-result">
          <div className="dcf-scenario-cards">{automaticResult.scenarios.map((scenario) => <article className="dcf-scenario-card" key={scenario.name}>
            <p className="analysis-eyebrow">{scenario.label}</p>
            <p className="big">{automaticResult.currency} {scenario.result.fairValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="cur">per share</span></p>
            <p className="note">FCF growth {(scenario.result.assumptions.annualGrowthRate * 100).toFixed(1)}% · WACC {(scenario.result.assumptions.discountRate * 100).toFixed(1)}% · Terminal growth {(scenario.result.assumptions.terminalGrowthRate * 100).toFixed(1)}%</p>
            <p className="note">Enterprise value {automaticResult.currency} {scenario.result.enterpriseValue.toLocaleString()} · Equity value {automaticResult.currency} {scenario.result.equityValue.toLocaleString()}</p>
            {scenario.result.exitMultipleValuation && <p className="note">Comps exit method: {automaticResult.currency} {scenario.result.exitMultipleValuation.fairValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })}/share at {scenario.result.exitMultipleValuation.multiple.toFixed(2)}x on Year 5 EBITDA.</p>}
          </article>)}</div>
          {automaticResult.comparableCompanies && <section className="comps-linked-result"><h4>Integrated Comps cross-check</h4><p>Peer median EV/EBITDA {automaticResult.comparableCompanies.result.statistics.evEbitda.median?.toFixed(2) ?? 'N/A'}x · {automaticResult.comparableCompanies.result.statistics.evEbitda.count} usable peers.</p><p className="note">The median comes from the reviewed Comps scenario. It is used only by the exit-multiple terminal method.</p></section>}
          <div className="table-scroll sensitivity-table"><h4>Five-year base-case DCF projection</h4><table><thead><tr><th>Year</th><th>Unlevered FCF</th><th>Discount factor</th><th>PV of FCF</th></tr></thead><tbody>{baseCase?.projections.map((projection) => <tr key={projection.year}><th>{projection.year}</th><td>{automaticResult.currency} {projection.freeCashFlow.toLocaleString()}</td><td>{projection.discountFactor.toFixed(3)}</td><td>{automaticResult.currency} {projection.presentValue.toLocaleString()}</td></tr>)}</tbody></table></div>
          <p className="note">{automaticResult.methodology}</p>
          <ul className="caveat">{automaticResult.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
          {automaticScenarioId && <a className="secondary-button report-download" href={`/api/discovery/valuations/${automaticScenarioId}/report`} target="_blank" rel="noreferrer">Open integrated DCF + Comps PDF</a>}
        </div>
      )}
      </>}
      </>}

      {activeTab === 'sensitivity' && <section className="sourced-sensitivity-view" id="sourced-valuation-panel" role="tabpanel" aria-labelledby="sourced-valuation-tab-sensitivity">
        <h4>Source-backed valuation sensitivities</h4>
        {!baseCase ? <p className="caveat">Generate the integrated model after all required source records and the reviewed Comps scenario are ready.</p> : <>
          <div className="table-scroll sensitivity-table"><h4>Base case · WACC vs. perpetual growth</h4><table><thead><tr><th>WACC \ g</th>{sensitivityGrowths.map((growth) => <th key={growth}>{(growth * 100).toFixed(2)}%</th>)}</tr></thead><tbody>{sensitivityWaccs.map((wacc) => <tr key={wacc}><th>{(wacc * 100).toFixed(2)}%</th>{sensitivityGrowths.map((growth) => { const cell = baseGrowthSensitivity.find((item) => Math.abs(item.discountRate - wacc) < 1e-10 && Math.abs(item.terminalGrowthRate - growth) < 1e-10); return <td key={growth}>{cell?.fairValuePerShare == null ? 'N/A' : `${automaticResult!.currency} ${cell.fairValuePerShare.toFixed(2)}`}</td>; })}</tr>)}</tbody></table></div>
          {baseCase.exitMultipleValuation && <div className="table-scroll sensitivity-table"><h4>Base case · WACC vs. peer EV/EBITDA</h4><table><thead><tr><th>WACC \ multiple</th>{exitSensitivityMultiples.map((multiple) => <th key={multiple}>{multiple.toFixed(2)}x</th>)}</tr></thead><tbody>{exitSensitivityWaccs.map((rate) => <tr key={rate}><th>{(rate * 100).toFixed(2)}%</th>{exitSensitivityMultiples.map((multiple) => { const cell = exitSensitivity.find((item) => item.exitMultiple === multiple && Math.abs(item.discountRate - rate) < 1e-10); return <td key={multiple}>{cell?.fairValuePerShare == null ? 'N/A' : `${automaticResult!.currency} ${cell.fairValuePerShare.toFixed(2)}`}</td>; })}</tr>)}</tbody></table></div>}
        </>}
      </section>}

      {activeTab === 'comps' && <section className="comps-panel" id="sourced-valuation-panel" role="tabpanel" aria-labelledby="sourced-valuation-tab-comps">
        <h4>Comparable-company analysis</h4>
        {compsBusy && !compsSetup ? <p className="note">Checking target financial data…</p> : compsError && !compsSetup ? <p className="caveat">{compsError}</p> : compsSetup && <>
          <p className="note">Target: <strong>{compsSetup.target.companyName}</strong> · {compsSetup.target.currency} · data as of {compsSetup.dataAsOf ? new Date(compsSetup.dataAsOf).toLocaleDateString() : 'unknown'}.</p>
          {compsSetup.missing.length > 0 && <p className="caveat">Target metrics unavailable: {compsSetup.missing.join(', ')}. A comparable result can use only metrics that are sourced for the target.</p>}
          <p className="note">Start with peer discovery, then review why each company was suggested. The system researches available public financial statements, market data, and explicitly labelled forward guidance/estimates. It never treats an incomplete search snippet as a fact.</p>
          <div className="comps-actions">
            <button className="secondary-button" type="button" onClick={() => void suggestPeers()} disabled={compsBusy}>Find peer candidates from web research</button>
            <button className="secondary-button" type="button" onClick={() => void researchPeers()} disabled={compsBusy}>Research and prefill selected peers</button>
          </div>
          {peerSuggestionNotice && <p className="note">{peerSuggestionNotice}</p>}
          <div className="table-scroll comps-input-table">
            <table>
              <thead><tr><th>Use</th><th>Peer company</th><th>Ticker</th><th>Exchange</th><th>Currency</th><th>Market cap</th><th>Net debt</th><th>LTM revenue</th><th>LTM EBITDA</th><th>LTM net income</th><th>NTM revenue</th><th>NTM EBITDA</th><th>NTM net income</th><th>Sources / selection rationale</th></tr></thead>
              <tbody>{peers.map((peer, index) => <tr key={index}>
                <td><input type="checkbox" aria-label={`Include ${peer.companyName || `peer ${index + 1}`} in valuation`} checked={peer.included} onChange={(event) => updatePeer(index, 'included', event.target.checked)} /></td>
                <td><input value={peer.companyName} onChange={(event) => updatePeer(index, 'companyName', event.target.value)} placeholder="Company" /></td>
                <td><input value={peer.ticker} onChange={(event) => updatePeer(index, 'ticker', event.target.value)} placeholder="Ticker" /></td>
                <td><input value={peer.exchange} onChange={(event) => updatePeer(index, 'exchange', event.target.value)} placeholder="XSWX" /></td>
                <td><input value={peer.currency} onChange={(event) => updatePeer(index, 'currency', event.target.value.toUpperCase())} placeholder="CHF" /></td>
                <td><input type="number" value={peer.marketCapitalization} onChange={(event) => updatePeer(index, 'marketCapitalization', event.target.value)} /></td>
                <td><input type="number" value={peer.netDebt} onChange={(event) => updatePeer(index, 'netDebt', event.target.value)} /></td>
                <td><input type="number" value={peer.revenue} onChange={(event) => updatePeer(index, 'revenue', event.target.value)} /></td>
                <td><input type="number" value={peer.ebitda} onChange={(event) => updatePeer(index, 'ebitda', event.target.value)} /></td>
                <td><input type="number" value={peer.netIncome} onChange={(event) => updatePeer(index, 'netIncome', event.target.value)} /></td>
                <td><input type="number" value={peer.ntmRevenue} onChange={(event) => updatePeer(index, 'ntmRevenue', event.target.value)} /></td>
                <td><input type="number" value={peer.ntmEbitda} onChange={(event) => updatePeer(index, 'ntmEbitda', event.target.value)} /></td>
                <td><input type="number" value={peer.ntmNetIncome} onChange={(event) => updatePeer(index, 'ntmNetIncome', event.target.value)} /></td>
                <td><input value={peer.sourceUrl} onChange={(event) => updatePeer(index, 'sourceUrl', event.target.value)} placeholder="Historical source URL" />
                  <input value={peer.forecastSourceUrl} onChange={(event) => updatePeer(index, 'forecastSourceUrl', event.target.value)} placeholder="Forward-data source URL" />
                  {peer.researchNote && <p className="note peer-research-note">{peer.researchNote}</p>}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {peers.length < 10 && <button className="secondary-button" type="button" onClick={() => setPeers((current) => [...current, emptyPeer()])}>Add peer</button>}
          {peers.length > 6 && <button className="secondary-button" type="button" onClick={() => setPeers((current) => current.slice(0, -1))}>Remove last peer</button>}
          {compsError && <p className="login-error" role="alert">{compsError}</p>}
          <p className="note">{includedPeerCount} peers selected · at least 6 with valid EV/EBITDA data are required for the integrated exit method.</p>
          <button className="action-button" type="button" onClick={() => void calculateComps()} disabled={compsBusy || includedPeerCount < 6}>Calculate comparable-company valuation</button>
          {compsResult && <div className="valuation-result">
            <p className="note">{compsResult.methodology}</p>
            <div className="table-scroll sensitivity-table">
              <h4>Peer multiple statistics</h4>
              <table><thead><tr><th>Multiple</th><th>n</th><th>Low</th><th>25th pct.</th><th>Median</th><th>Mean</th><th>75th pct.</th><th>High</th></tr></thead>
                <tbody>{([['EV / Revenue (LTM)', compsResult.statistics.evRevenue], ['EV / EBITDA (LTM)', compsResult.statistics.evEbitda], ['P / E (LTM)', compsResult.statistics.pe], ['EV / Revenue (NTM)', compsResult.statistics.evNtmRevenue], ['EV / EBITDA (NTM)', compsResult.statistics.evNtmEbitda], ['P / E (NTM)', compsResult.statistics.ntmPe]] as const).map(([label, stats]) => <tr key={label}><th>{label}</th><td>{stats.count}</td><td>{stats.low?.toFixed(2) ?? 'N/A'}x</td><td>{stats.percentile25?.toFixed(2) ?? 'N/A'}x</td><td>{stats.median?.toFixed(2) ?? 'N/A'}x</td><td>{stats.mean?.toFixed(2) ?? 'N/A'}x</td><td>{stats.percentile75?.toFixed(2) ?? 'N/A'}x</td><td>{stats.high?.toFixed(2) ?? 'N/A'}x</td></tr>)}</tbody>
              </table>
            </div>
            <section className="comparability-guide">
              <h4>How peer comparison is assessed</h4>
              <div className="research-framework-grid">
                <div><strong>Valuation</strong><p>EV / EBITDA for operational comparability; P / E for mature profitable peers; EV / Revenue when earnings are not meaningful; P / Book for asset-heavy financial businesses.</p></div>
                <div><strong>Profitability</strong><p>Gross, operating and net margins, ROE, and ROIC are calculated only when the filing supplies the required tax, debt, equity, cash, and operating-income inputs.</p></div>
                <div><strong>Growth</strong><p>Revenue, EBITDA and EPS growth distinguish high-growth from mature peers. NTM figures are only shown when explicitly sourced.</p></div>
                <div><strong>Financial health</strong><p>Net debt / EBITDA, debt-to-equity, and interest coverage test whether apparent valuation differences are actually leverage differences.</p></div>
              </div>
            </section>
            <div className="table-scroll sensitivity-table">
              <h4>Implied valuation range</h4>
              <table><thead><tr><th>Method</th><th>Statistic</th><th>Multiple</th><th>Implied EV</th><th>Implied equity value</th><th>Per share</th></tr></thead>
                <tbody>{compsResult.impliedValuations.map((valuation, index) => <tr key={`${valuation.multiple}-${valuation.statistic}-${index}`}><td>{valuation.multiple}</td><td>{valuation.statistic}</td><td>{valuation.multipleValue.toFixed(2)}x</td><td>{valuation.impliedEnterpriseValue == null ? 'N/A' : `${compsResult.currency} ${valuation.impliedEnterpriseValue.toLocaleString()}`}</td><td>{valuation.impliedEquityValue == null ? 'N/A' : `${compsResult.currency} ${valuation.impliedEquityValue.toLocaleString()}`}</td><td>{valuation.impliedValuePerShare == null ? 'N/A' : `${compsResult.currency} ${valuation.impliedValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="table-scroll sensitivity-table">
              <h4>Peer operating and financial-health comparison</h4>
              <table><thead><tr><th>Peer</th><th>P / Book</th><th>Gross margin</th><th>Operating margin</th><th>EBITDA margin</th><th>Net margin</th><th>ROIC</th><th>ROE</th><th>NTM revenue growth</th><th>NTM EBITDA growth</th><th>Net debt / EBITDA</th><th>Debt / equity</th><th>Interest coverage</th></tr></thead>
                <tbody>{compsResult.peers.map((peer) => <tr key={peer.ticker}><th>{peer.companyName} ({peer.ticker} · {peer.currency})</th><td>{peer.priceToBook == null ? 'N/A' : `${peer.priceToBook.toFixed(2)}x`}</td><td>{peer.grossMargin == null ? 'N/A' : `${(peer.grossMargin * 100).toFixed(1)}%`}</td><td>{peer.operatingMargin == null ? 'N/A' : `${(peer.operatingMargin * 100).toFixed(1)}%`}</td><td>{peer.ebitdaMargin == null ? 'N/A' : `${(peer.ebitdaMargin * 100).toFixed(1)}%`}</td><td>{peer.netMargin == null ? 'N/A' : `${(peer.netMargin * 100).toFixed(1)}%`}</td><td>{peer.roic == null ? 'N/A' : `${(peer.roic * 100).toFixed(1)}%`}</td><td>{peer.returnOnEquity == null ? 'N/A' : `${(peer.returnOnEquity * 100).toFixed(1)}%`}</td><td>{peer.ntmRevenueGrowth == null ? 'N/A' : `${(peer.ntmRevenueGrowth * 100).toFixed(1)}%`}</td><td>{peer.ntmEbitdaGrowth == null ? 'N/A' : `${(peer.ntmEbitdaGrowth * 100).toFixed(1)}%`}</td><td>{peer.netDebtEbitda == null ? 'N/A' : `${peer.netDebtEbitda.toFixed(2)}x`}</td><td>{peer.debtToEquity == null ? 'N/A' : `${peer.debtToEquity.toFixed(2)}x`}</td><td>{peer.interestCoverage == null ? 'N/A' : `${peer.interestCoverage.toFixed(2)}x`}</td></tr>)}</tbody>
              </table>
            </div>
            {compsResult.peers.some((peer) => peer.outlierMultiples.length > 0) && <p className="caveat">Outlier review: {compsResult.peers.filter((peer) => peer.outlierMultiples.length > 0).map((peer) => `${peer.ticker} (${peer.outlierMultiples.join(', ')})`).join(' · ')}</p>}
            <ul className="caveat">{compsResult.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
          </div>}
        </>}
      </section>}
    </section>
  );
}
