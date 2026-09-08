'use client';

import { useEffect, useMemo, useState } from 'react';

type Severity = 'info' | 'watch' | 'breach';
interface Policy { maxPositionWeight: number; maxSectorWeight: number; maxCountryWeight: number; minimumHoldings: number; stalePriceDays: number; staleResearchDays: number; reviewIntervalDays: number; }
interface GovernanceData {
  generatedAt: string;
  policy: Policy;
  construction: Array<{ portfolioName: string; currency: string; holdingCount: number; weightsAvailable: boolean; issues: Array<{ severity: Severity; label: string; detail: string }>; sectors: Array<{ name: string; weight: number }>; countries: Array<{ name: string; weight: number }>; holdings: Array<{ ticker: string; companyName: string; weight: number | null }>; attribution: Array<{ ticker: string; contribution: number; dataAsOf: string | null }>; riskAsOf: string | null }>;
  freshness: Array<{ portfolioName: string; ticker: string; companyName: string; priceAgeDays: number | null; analysisAgeDays: number | null; evidenceAgeDays: number | null; priceStatus: string; evidenceStatus: string; analysisStatus: string; lastPriceDate: string | null; latestProvider: string | null }>;
  reviewQueue: Array<{ severity: Severity; title: string; detail: string; portfolioName: string | null; ticker: string | null; category: string }>;
  providerHealth: Array<{ provider: string; endpoint: string; ok: number; errors: number; planLimits: number; rateLimited: number; lastCalledAt: string }>;
  committeeMemos: Array<{ candidateId: string; companyName: string; ticker: string; portfolioName: string; decision: string; thesisVersion: number | null; investmentThesis: string | null; catalysts: string[]; risks: string[]; gaps: string[]; evidenceAsOf: string | null; valuation: { currency: string; fairValuePerShare: number; terminalShare: number | null; caveats: string[] } | null; journal: Record<string, string> | null; decisionDate: string | null }>;
  valuationCoverage: { total: number; dcf: number; comparables: number; latest: Array<{ candidate: string; method: string; createdAt: string; status: string }> };
  versioning: { thesisVersions: Array<{ version: number; effectiveDate: string; supersededAt: string | null; excludedAt: string | null }>; decisions: Array<{ title: string; decision: string; date: string; metadata: { thesisVersionId?: string; valuationScenarioId?: string; evidenceAsOf?: string } | null }> };
  monitoringCoverage: Array<{ capability: string; status: string; detail: string }>;
}

function percent(value: number | null | undefined) { return value == null ? '—' : `${(value * 100).toFixed(1)}%`; }
function age(value: number | null) { return value == null ? 'not available' : `${value} day${value === 1 ? '' : 's'}`; }

export function GovernanceDashboard() {
  const [data, setData] = useState<GovernanceData | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch('/api/governance');
      const body = await response.json().catch(() => ({})) as GovernanceData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Governance data failed (${response.status})`);
      setData(body); setPolicy(body.policy); setError(null);
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const queue = useMemo(() => data?.reviewQueue ?? [], [data]);

  async function savePolicy() {
    if (!policy) return;
    setSaving(true); setNotice(null);
    try {
      const response = await fetch('/api/governance', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(policy) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Policy save failed (${response.status})`);
      setNotice('Guardrails saved. They create review prompts only; they never place trades.');
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setSaving(false); }
  }
  function updatePolicy(key: keyof Policy, value: string, percentInput = false) {
    setPolicy((current) => current ? { ...current, [key]: percentInput ? Number(value) / 100 : Number(value) } : current);
  }
  if (loading && !data) return <main><h1>Investment control center</h1><p className="note">Loading governance evidence…</p></main>;
  if (!data || !policy) return <main><h1>Investment control center</h1><p className="login-error">{error ?? 'Governance data is unavailable.'}</p></main>;

  return <main>
    <h1>Investment control center</h1>
    <p className="sub">Construction, evidence freshness, valuation discipline, portfolio attribution, and review priorities. These are decision guardrails—not automated trading instructions.</p>
    {error && <p className="login-error" role="alert">{error}</p>}
    {notice && <p className="security-state">{notice}</p>}

    <section className="governance-kpis" aria-label="Control summary">
      <article className="card"><span>Review queue</span><strong>{queue.length}</strong><p>{queue.filter((item) => item.severity === 'breach').length} breaches · {queue.filter((item) => item.severity === 'watch').length} watch items</p></article>
      <article className="card"><span>Valuation scenarios</span><strong>{data.valuationCoverage.total}</strong><p>{data.valuationCoverage.dcf} DCF · {data.valuationCoverage.comparables} comparables</p></article>
      <article className="card"><span>Freshness coverage</span><strong>{data.freshness.filter((item) => item.priceStatus === 'current').length}/{data.freshness.length}</strong><p>holdings with current price evidence</p></article>
      <article className="card"><span>Thesis versions</span><strong>{data.versioning.thesisVersions.length}</strong><p>Immutable decisions retain the context available when made.</p></article>
    </section>

    <section className="card governance-section">
      <div className="section-heading"><div><h2>Priority review queue</h2><p className="note">Generated from stored data, alerts, approved thesis breakers, and the policy below.</p></div><button className="secondary-button" type="button" onClick={() => void load()}>Refresh</button></div>
      {queue.length === 0 ? <p className="note">No current review prompts. This does not prove the portfolio is risk-free; it means no configured, evidence-based trigger is currently open.</p> : <div className="governance-queue">{queue.map((item, index) => <article key={`${item.category}:${item.title}:${index}`} className={`governance-queue-item ${item.severity}`}><span className={`badge ${item.severity === 'info' ? 'ok' : item.severity}`}>{item.category}</span><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.portfolioName ?? 'All portfolios'}{item.ticker ? ` · ${item.ticker}` : ''}</small></div></article>)}</div>}
    </section>

    <section className="card governance-section">
      <h2>Portfolio construction and attribution</h2>
      <p className="note">Weights are evaluated only within each portfolio; native-currency portfolios are never summed into a misleading combined total.</p>
      <div className="governance-portfolio-grid">{data.construction.map((portfolio) => <article className="governance-portfolio" key={portfolio.portfolioName}>
        <h3>{portfolio.portfolioName} <span className="cur">{portfolio.currency}</span></h3>
        <p className="note">{portfolio.holdingCount} holdings · {portfolio.weightsAvailable ? 'weights current' : 'weights need pricing before concentration can be assessed'}</p>
        {portfolio.issues.length ? <ul className="caveat">{portfolio.issues.map((issue) => <li key={issue.label}><strong>{issue.label}:</strong> {issue.detail}</li>)}</ul> : <p className="security-state">No baseline construction breach detected.</p>}
        <div className="governance-exposures"><div><strong>Largest positions</strong>{portfolio.holdings.slice(0, 5).map((holding) => <p key={holding.ticker}>{holding.ticker} <span>{percent(holding.weight)}</span></p>)}</div><div><strong>Sector exposure</strong>{portfolio.sectors.slice(0, 4).map((item) => <p key={item.name}>{item.name} <span>{percent(item.weight)}</span></p>)}</div><div><strong>Country exposure</strong>{portfolio.countries.slice(0, 4).map((item) => <p key={item.name}>{item.name} <span>{percent(item.weight)}</span></p>)}</div></div>
        <div className="governance-attribution"><strong>Return contribution</strong>{portfolio.attribution.length ? portfolio.attribution.slice(0, 5).map((item) => <p key={item.ticker}>{item.ticker} <span>{percent(item.contribution)}</span></p>) : <p className="note">Not yet available—run the scheduled price refresh after at least two observations.</p>}</div>
      </article>)}</div>
    </section>

    <section className="card governance-section">
      <h2>Evidence freshness</h2>
      <div className="table-scroll"><table><thead><tr><th>Holding</th><th>Portfolio</th><th>Price</th><th>Research</th><th>Other evidence</th><th>Source</th></tr></thead><tbody>{data.freshness.map((item) => <tr key={`${item.portfolioName}:${item.ticker}`}><td><strong>{item.companyName}</strong><br /><span className="note">{item.ticker}</span></td><td>{item.portfolioName}</td><td>{item.priceStatus} · {age(item.priceAgeDays)}</td><td>{item.analysisStatus} · {age(item.analysisAgeDays)}</td><td>{item.evidenceStatus} · {age(item.evidenceAgeDays)}</td><td>{item.latestProvider ?? '—'}</td></tr>)}</tbody></table></div>
    </section>

    <section className="card governance-section">
      <h2>Investment committee memos</h2>
      <p className="note">Decision-ready summaries replace operational IDs with thesis, valuation, risks, source gaps, and the original human decision context.</p>
      {data.committeeMemos.length === 0 ? <p className="note">No approved or watchlist research candidate is available yet.</p> : <div className="committee-grid">{data.committeeMemos.map((memo) => <article className="committee-memo" key={memo.candidateId}><div className="section-heading"><div><h3>{memo.companyName} <span className="note">{memo.ticker}</span></h3><p>{memo.portfolioName} · Thesis v{memo.thesisVersion ?? 'not linked'} · {memo.decision}</p></div><span className="badge">{memo.evidenceAsOf ? `Evidence ${new Date(memo.evidenceAsOf).toLocaleDateString()}` : 'Evidence date missing'}</span></div><p><strong>Thesis:</strong> {memo.investmentThesis ?? 'No thesis narrative stored.'}</p>{memo.valuation && <p><strong>DCF scenario:</strong> {memo.valuation.currency} {memo.valuation.fairValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })} per share{memo.valuation.terminalShare != null ? ` · terminal value ${(memo.valuation.terminalShare * 100).toFixed(0)}% of EV` : ''}</p>}<p className="note"><strong>Catalysts:</strong> {memo.catalysts.join(' · ') || 'Not recorded'}</p><p className="caveat"><strong>Risks:</strong> {memo.risks.join(' · ') || 'Not recorded'}</p><p className="note"><strong>Evidence gaps:</strong> {memo.gaps.join(' · ') || 'None recorded'}</p>{memo.journal && <details><summary>Original decision journal</summary><p><strong>Reason:</strong> {memo.journal.decisionReason}</p><p><strong>Horizon:</strong> {memo.journal.expectedHoldingPeriod}</p><p><strong>Valuation view:</strong> {memo.journal.valuationView}</p><p><strong>Invalidation:</strong> {memo.journal.invalidationTrigger}</p></details>}</article>)}</div>}
    </section>

    <section className="card governance-section"><h2>Monitoring coverage</h2><div className="governance-coverage">{data.monitoringCoverage.map((item) => <article key={item.capability}><strong>{item.capability}</strong><span className={`badge ${item.status === 'active' ? 'ok' : 'watch'}`}>{item.status.replace('_', ' ')}</span><p>{item.detail}</p></article>)}</div></section>

    <section className="card governance-section"><h2>Provider health</h2><p className="note">Aggregated call outcomes are operational diagnostics; no credentials or request payloads are exposed here.</p>{data.providerHealth.length === 0 ? <p className="note">No provider calls have been recorded.</p> : <div className="table-scroll"><table><thead><tr><th>Provider</th><th>Endpoint</th><th>OK</th><th>Errors</th><th>Plan limits</th><th>Rate limits</th><th>Last call</th></tr></thead><tbody>{data.providerHealth.map((item) => <tr key={`${item.provider}:${item.endpoint}`}><td>{item.provider}</td><td><code>{item.endpoint}</code></td><td>{item.ok}</td><td>{item.errors}</td><td>{item.planLimits}</td><td>{item.rateLimited}</td><td>{new Date(item.lastCalledAt).toLocaleString()}</td></tr>)}</tbody></table></div>}</section>

    <section className="card governance-section"><h2>Versioned governance record</h2><div className="governance-versioning"><div><strong>Thesis history</strong>{data.versioning.thesisVersions.map((thesis) => <p key={thesis.version}>Version {thesis.version} · effective {new Date(thesis.effectiveDate).toLocaleDateString()}{thesis.excludedAt ? ' · excluded' : thesis.supersededAt ? ' · superseded' : ' · active'}</p>)}</div><div><strong>Recent immutable decisions</strong>{data.versioning.decisions.map((decision, index) => <p key={`${decision.date}:${index}`}>{new Date(decision.date).toLocaleDateString()} · {decision.decision} · {decision.title}{decision.metadata?.thesisVersionId ? ' · thesis snapshot retained' : ''}</p>)}</div></div></section>

    <section className="card governance-section"><h2>Guardrail policy</h2><p className="note">These defaults produce review prompts, not buy/sell recommendations. Tune them to the mandate after you decide your intended portfolio concentration.</p><div className="governance-policy-grid"><label>Maximum position (%)<input type="number" min="2" max="100" value={(policy.maxPositionWeight * 100).toFixed(0)} onChange={(event) => updatePolicy('maxPositionWeight', event.target.value, true)} /></label><label>Maximum sector (%)<input type="number" min="5" max="100" value={(policy.maxSectorWeight * 100).toFixed(0)} onChange={(event) => updatePolicy('maxSectorWeight', event.target.value, true)} /></label><label>Maximum country (%)<input type="number" min="5" max="100" value={(policy.maxCountryWeight * 100).toFixed(0)} onChange={(event) => updatePolicy('maxCountryWeight', event.target.value, true)} /></label><label>Minimum holdings<input type="number" min="1" max="100" value={policy.minimumHoldings} onChange={(event) => updatePolicy('minimumHoldings', event.target.value)} /></label><label>Price stale after (days)<input type="number" min="1" max="30" value={policy.stalePriceDays} onChange={(event) => updatePolicy('stalePriceDays', event.target.value)} /></label><label>Research stale after (days)<input type="number" min="7" max="730" value={policy.staleResearchDays} onChange={(event) => updatePolicy('staleResearchDays', event.target.value)} /></label><label>Review interval (days)<input type="number" min="7" max="365" value={policy.reviewIntervalDays} onChange={(event) => updatePolicy('reviewIntervalDays', event.target.value)} /></label></div><button className="action-button" type="button" onClick={() => void savePolicy()} disabled={saving}>{saving ? 'Saving…' : 'Save guardrails'}</button></section>
  </main>;
}
