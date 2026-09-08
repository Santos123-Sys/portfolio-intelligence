'use client';

import { useEffect, useState } from 'react';

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
  };
  latestScenario: { resultJson: DcfResult } | null;
}

interface DcfResult {
  currency: string;
  fairValuePerShare: number;
  enterpriseValue: number;
  equityValue: number;
  methodology: string;
  caveats: string[];
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
  peers: Array<{ companyName: string; ticker: string; enterpriseValue: number; evRevenue: number | null; evEbitda: number | null; pe: number | null; outlierMultiples: string[] }>;
  statistics: Record<'evRevenue' | 'evEbitda' | 'pe', { count: number; mean: number | null; median: number | null; percentile25: number | null; percentile75: number | null }>;
  impliedValuations: Array<{ multiple: string; statistic: string; multipleValue: number; impliedEnterpriseValue: number | null; impliedEquityValue: number | null; impliedValuePerShare: number | null }>;
  methodology: string;
  caveats: string[];
}

interface PeerForm {
  companyName: string;
  ticker: string;
  marketCapitalization: string;
  netDebt: string;
  revenue: string;
  ebitda: string;
  netIncome: string;
  sourceUrl: string;
}

function emptyPeer(): PeerForm {
  return { companyName: '', ticker: '', marketCapitalization: '', netDebt: '', revenue: '', ebitda: '', netIncome: '', sourceUrl: '' };
}

function initial(value: number | null): string {
  return value == null ? '' : String(value);
}

export function ValuationWorkbench({ candidateId, onSaved }: { candidateId: string; onSaved: () => void }) {
  const [setup, setSetup] = useState<ValuationSetup | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DcfResult | null>(null);
  const [compsSetup, setCompsSetup] = useState<ComparableSetup | null>(null);
  const [peers, setPeers] = useState<PeerForm[]>(() => Array.from({ length: 6 }, emptyPeer));
  const [compsResult, setCompsResult] = useState<ComparableResult | null>(null);
  const [compsBusy, setCompsBusy] = useState(true);
  const [compsError, setCompsError] = useState<string | null>(null);
  const [primarySourceBusy, setPrimarySourceBusy] = useState(false);
  const [primarySourceNotice, setPrimarySourceNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setConfirmed(false);
    setError(null);
    setResult(null);
    fetch(`/api/discovery/valuations?candidateId=${encodeURIComponent(candidateId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ValuationSetup & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `Valuation setup failed (${response.status})`);
        setSetup(body);
        setResult(body.latestScenario?.resultJson ?? null);
        setValues({
          startingFreeCashFlow: initial(body.defaults.startingFreeCashFlow),
          netDebt: initial(body.defaults.netDebt),
          sharesOutstanding: initial(body.defaults.sharesOutstanding),
          forecastYears: String(body.defaults.forecastYears),
          annualGrowthRate: '',
          discountRate: '',
          terminalGrowthRate: '',
        });
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

  function update(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function calculate() {
    if (!setup) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/discovery/valuations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          candidateId,
          startingFreeCashFlow: Number(values.startingFreeCashFlow),
          netDebt: Number(values.netDebt),
          sharesOutstanding: Number(values.sharesOutstanding),
          forecastYears: Number(values.forecastYears),
          annualGrowthRate: Number(values.annualGrowthRate) / 100,
          discountRate: Number(values.discountRate) / 100,
          terminalGrowthRate: Number(values.terminalGrowthRate) / 100,
          sourceReferences: setup.defaults.sourceReferences,
          methodSuitabilityConfirmed: confirmed,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; result?: DcfResult };
      if (!response.ok || !body.result) throw new Error(body.error ?? `DCF failed (${response.status})`);
      setResult(body.result);
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updatePeer(index: number, key: keyof PeerForm, value: string) {
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
          peers: peers.map((peer) => ({
            companyName: peer.companyName,
            ticker: peer.ticker,
            marketCapitalization: Number(peer.marketCapitalization),
            netDebt: Number(peer.netDebt),
            revenue: peer.revenue === '' ? undefined : Number(peer.revenue),
            ebitda: peer.ebitda === '' ? undefined : Number(peer.ebitda),
            netIncome: peer.netIncome === '' ? undefined : Number(peer.netIncome),
            sourceUrl: peer.sourceUrl,
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
      setPrimarySourceNotice(`Imported ${body.importedMetrics?.length ?? 0} primary-source metrics. Review the filing scope, then complete the DCF assumptions.`);
      setReloadToken((current) => current + 1);
    } catch (cause) {
      setPrimarySourceNotice((cause as Error).message);
    } finally {
      setPrimarySourceBusy(false);
    }
  }

  if (busy && !setup && compsBusy && !compsSetup) return <p className="note">Loading valuation evidence…</p>;
  if (!setup && !compsSetup && !busy && !compsBusy) return <p className="login-error" role="alert">{error ?? compsError ?? 'Valuation evidence is unavailable.'}</p>;
  const valuationBlocked = setup?.suitability.status === 'insufficient_data';
  const dcfInputsComplete = ['startingFreeCashFlow', 'netDebt', 'sharesOutstanding', 'forecastYears', 'annualGrowthRate', 'discountRate', 'terminalGrowthRate']
    .every((key) => values[key]?.trim() !== '');
  const discountRates = [...new Set(result?.sensitivity.map((cell) => cell.discountRate) ?? [])];
  const terminalGrowthRates = [...new Set(result?.sensitivity.map((cell) => cell.terminalGrowthRate) ?? [])];

  return (
    <section className="valuation-panel">
      <p className="analysis-eyebrow">4. Valuation</p>
      <h3>Valuation workspace</h3>
      <p className="note">Use a DCF only with structured financial statements. Use comparable companies to triangulate value from a sourced, human-reviewed peer set. Neither output is a trade instruction.</p>
      <div className="primary-source-cta">
        <div><strong>Primary-source financials</strong><p>Retrieve available inline-XBRL annual-report or 10-K values from investor-relations or regulatory filing pages. The system keeps the filing URL and will only unlock DCF when the required fields are present.</p></div>
        <button className="secondary-button" type="button" onClick={() => void retrievePrimarySourceFinancials()} disabled={primarySourceBusy}>{primarySourceBusy ? 'Retrieving…' : 'Retrieve financial statements'}</button>
      </div>
      {primarySourceNotice && <p className={primarySourceNotice.startsWith('Imported') ? 'note' : 'caveat'}>{primarySourceNotice}</p>}
      {!setup ? <section className="dcf-unavailable">
        <h4>DCF scenario</h4>
        <p className="caveat">{busy ? 'Checking structured financial-statement evidence…' : error ?? 'DCF cannot be prepared from the current evidence.'}</p>
        <p className="note">This does not block comparable-company analysis. It prevents a DCF from using unsupported cash-flow, debt, or share-count inputs.</p>
      </section> : <>
      <h4>DCF scenario</h4>
      <p className={setup.suitability.status === 'review_required' ? 'note' : 'caveat'}>{setup.suitability.rationale}</p>
      <p className="note">Currency: {setup.defaults.currency} · Evidence as of {setup.defaults.dataAsOf ? new Date(setup.defaults.dataAsOf).toLocaleDateString() : 'unknown'}.</p>
      <div className="valuation-grid">
        <label>Starting free cash flow
          <input type="number" inputMode="decimal" required value={values.startingFreeCashFlow ?? ''} onChange={(event) => update('startingFreeCashFlow', event.target.value)} />
        </label>
        <label>Net debt
          <input type="number" inputMode="decimal" required value={values.netDebt ?? ''} onChange={(event) => update('netDebt', event.target.value)} />
        </label>
        <label>Shares outstanding
          <input type="number" inputMode="decimal" min="0" step="any" required value={values.sharesOutstanding ?? ''} onChange={(event) => update('sharesOutstanding', event.target.value)} />
        </label>
        <label>Forecast years
          <input type="number" inputMode="numeric" min="1" max="10" required value={values.forecastYears ?? ''} onChange={(event) => update('forecastYears', event.target.value)} />
        </label>
        <label>Annual growth (%)
          <input type="number" inputMode="decimal" min="-50" max="50" step="0.1" required value={values.annualGrowthRate ?? ''} onChange={(event) => update('annualGrowthRate', event.target.value)} />
        </label>
        <label>Discount rate (%)
          <input type="number" inputMode="decimal" min="0.01" max="50" step="0.1" required value={values.discountRate ?? ''} onChange={(event) => update('discountRate', event.target.value)} />
        </label>
        <label>Terminal growth (%)
          <input type="number" inputMode="decimal" min="-5" max="5" step="0.1" required value={values.terminalGrowthRate ?? ''} onChange={(event) => update('terminalGrowthRate', event.target.value)} />
        </label>
      </div>
      <label className="confirmation-row">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        I reviewed the method and every assumption. I understand that this is an analytical scenario, not a price guarantee.
      </label>
      {error && <p className="login-error" role="alert">{error}</p>}
      {!dcfInputsComplete && <p className="note">To run the DCF, provide growth, discount-rate, and terminal-growth assumptions after reviewing the retrieved annual-report figures.</p>}
      <button className="action-button" type="button" onClick={() => void calculate()} disabled={busy || !confirmed || valuationBlocked || !dcfInputsComplete}>
        {busy ? 'Calculating…' : 'Calculate deterministic DCF'}
      </button>
      {result && (
        <div className="valuation-result">
          <p className="big">{result.currency} {result.fairValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="cur">per share</span></p>
          <p className="note">Enterprise value {result.currency} {result.enterpriseValue.toLocaleString()} · Equity value {result.currency} {result.equityValue.toLocaleString()}</p>
          <p className="note">{result.methodology}</p>
          <ul className="caveat">{result.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
          {discountRates.length > 0 && terminalGrowthRates.length > 0 && <div className="table-scroll sensitivity-table">
            <h4>Fair value sensitivity</h4>
            <table>
              <thead><tr><th>Discount ↓ / Terminal →</th>{terminalGrowthRates.map((rate) => <th key={rate}>{(rate * 100).toFixed(1)}%</th>)}</tr></thead>
              <tbody>{discountRates.map((discountRate) => <tr key={discountRate}>
                <th>{(discountRate * 100).toFixed(1)}%</th>
                {terminalGrowthRates.map((terminalGrowthRate) => {
                  const cell = result.sensitivity.find((item) => item.discountRate === discountRate && item.terminalGrowthRate === terminalGrowthRate);
                  return <td key={terminalGrowthRate}>{cell?.fairValuePerShare == null ? 'N/A' : cell.fairValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>}
        </div>
      )}
      </>}

      <section className="comps-panel">
        <h4>Comparable-company analysis</h4>
        {compsBusy && !compsSetup ? <p className="note">Checking target financial data…</p> : compsError && !compsSetup ? <p className="caveat">{compsError}</p> : compsSetup && <>
          <p className="note">Target: <strong>{compsSetup.target.companyName}</strong> · {compsSetup.target.currency} · data as of {compsSetup.dataAsOf ? new Date(compsSetup.dataAsOf).toLocaleDateString() : 'unknown'}.</p>
          {compsSetup.missing.length > 0 && <p className="caveat">Target metrics unavailable: {compsSetup.missing.join(', ')}. A comparable result can use only metrics that are sourced for the target.</p>}
          <p className="note">Add 6–10 public peers. Enter each peer’s market capitalization, net debt, operating metrics, and a public source URL. The system computes EV, multiples, statistics, outlier flags, and implied values.</p>
          <div className="table-scroll comps-input-table">
            <table>
              <thead><tr><th>Peer company</th><th>Ticker</th><th>Market cap</th><th>Net debt</th><th>LTM revenue</th><th>LTM EBITDA</th><th>LTM net income</th><th>Public source URL</th></tr></thead>
              <tbody>{peers.map((peer, index) => <tr key={index}>
                <td><input value={peer.companyName} onChange={(event) => updatePeer(index, 'companyName', event.target.value)} placeholder="Company" /></td>
                <td><input value={peer.ticker} onChange={(event) => updatePeer(index, 'ticker', event.target.value)} placeholder="Ticker" /></td>
                <td><input type="number" value={peer.marketCapitalization} onChange={(event) => updatePeer(index, 'marketCapitalization', event.target.value)} /></td>
                <td><input type="number" value={peer.netDebt} onChange={(event) => updatePeer(index, 'netDebt', event.target.value)} /></td>
                <td><input type="number" value={peer.revenue} onChange={(event) => updatePeer(index, 'revenue', event.target.value)} /></td>
                <td><input type="number" value={peer.ebitda} onChange={(event) => updatePeer(index, 'ebitda', event.target.value)} /></td>
                <td><input type="number" value={peer.netIncome} onChange={(event) => updatePeer(index, 'netIncome', event.target.value)} /></td>
                <td><input value={peer.sourceUrl} onChange={(event) => updatePeer(index, 'sourceUrl', event.target.value)} placeholder="https://…" /></td>
              </tr>)}</tbody>
            </table>
          </div>
          {peers.length < 10 && <button className="secondary-button" type="button" onClick={() => setPeers((current) => [...current, emptyPeer()])}>Add peer</button>}
          {peers.length > 6 && <button className="secondary-button" type="button" onClick={() => setPeers((current) => current.slice(0, -1))}>Remove last peer</button>}
          {compsError && <p className="login-error" role="alert">{compsError}</p>}
          <button className="action-button" type="button" onClick={() => void calculateComps()} disabled={compsBusy}>Calculate comparable-company valuation</button>
          {compsResult && <div className="valuation-result">
            <p className="note">{compsResult.methodology}</p>
            <div className="table-scroll sensitivity-table">
              <h4>Peer multiple statistics</h4>
              <table><thead><tr><th>Multiple</th><th>n</th><th>25th percentile</th><th>Median</th><th>Mean</th><th>75th percentile</th></tr></thead>
                <tbody>{([['EV / Revenue', compsResult.statistics.evRevenue], ['EV / EBITDA', compsResult.statistics.evEbitda], ['P / E', compsResult.statistics.pe]] as const).map(([label, stats]) => <tr key={label}><th>{label}</th><td>{stats.count}</td><td>{stats.percentile25?.toFixed(2) ?? 'N/A'}x</td><td>{stats.median?.toFixed(2) ?? 'N/A'}x</td><td>{stats.mean?.toFixed(2) ?? 'N/A'}x</td><td>{stats.percentile75?.toFixed(2) ?? 'N/A'}x</td></tr>)}</tbody>
              </table>
            </div>
            <div className="table-scroll sensitivity-table">
              <h4>Implied valuation range</h4>
              <table><thead><tr><th>Method</th><th>Statistic</th><th>Multiple</th><th>Implied EV</th><th>Implied equity value</th><th>Per share</th></tr></thead>
                <tbody>{compsResult.impliedValuations.map((valuation, index) => <tr key={`${valuation.multiple}-${valuation.statistic}-${index}`}><td>{valuation.multiple}</td><td>{valuation.statistic}</td><td>{valuation.multipleValue.toFixed(2)}x</td><td>{valuation.impliedEnterpriseValue == null ? 'N/A' : `${compsResult.currency} ${valuation.impliedEnterpriseValue.toLocaleString()}`}</td><td>{valuation.impliedEquityValue == null ? 'N/A' : `${compsResult.currency} ${valuation.impliedEquityValue.toLocaleString()}`}</td><td>{valuation.impliedValuePerShare == null ? 'N/A' : `${compsResult.currency} ${valuation.impliedValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</td></tr>)}</tbody>
              </table>
            </div>
            {compsResult.peers.some((peer) => peer.outlierMultiples.length > 0) && <p className="caveat">Outlier review: {compsResult.peers.filter((peer) => peer.outlierMultiples.length > 0).map((peer) => `${peer.ticker} (${peer.outlierMultiples.join(', ')})`).join(' · ')}</p>}
            <ul className="caveat">{compsResult.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
          </div>}
        </>}
      </section>
    </section>
  );
}
