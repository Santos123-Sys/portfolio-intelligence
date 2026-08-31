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
  }, [candidateId]);

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

  if (busy && !setup) return <p className="note">Loading valuation evidence…</p>;
  if (error && !setup) return <p className="login-error" role="alert">{error}</p>;
  if (!setup) return null;
  const valuationBlocked = setup.suitability.status === 'insufficient_data';
  const discountRates = [...new Set(result?.sensitivity.map((cell) => cell.discountRate) ?? [])];
  const terminalGrowthRates = [...new Set(result?.sensitivity.map((cell) => cell.terminalGrowthRate) ?? [])];

  return (
    <section className="valuation-panel">
      <h3>Human-confirmed DCF</h3>
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
      <button className="action-button" type="button" onClick={() => void calculate()} disabled={busy || !confirmed || valuationBlocked}>
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
    </section>
  );
}
