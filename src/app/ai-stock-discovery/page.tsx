'use client';

import { useCallback, useEffect, useState } from 'react';
import { ValuationWorkbench } from '@/components/valuation-workbench';

interface DiscoveryRun {
  id: string;
  externalDiscoveryId: string;
  status: string;
  provider: string;
  requestedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  candidateCount: number;
}

interface RiskMetric {
  metricName: string;
  value: number;
  methodology: string;
  caveat: string | null;
}

interface Candidate {
  id: string;
  ticker: string;
  exchange: string;
  companyName: string;
  currency: string;
  country: string | null;
  sector: string | null;
  portfolioName: string;
  decision: string;
  workflowStatus: string;
  externalAnalysisRunId: string | null;
  analysisRunStatus: string | null;
  discoveryJson: {
    thesisAlignmentScore: number;
    rationale: string;
    matchedCriteria: string[];
    violatedCriteria: string[];
    informationGaps: string[];
    groundedIn: string[];
    sourceUrls: string[];
  };
  risk: RiskMetric[] | null;
  analysis: {
    investmentScore: number;
    thesisAlignmentScore: number;
    qualityScore: number | null;
    growthScore: number | null;
    riskScore: number | null;
    dividendScore: number | null;
    confidenceScore: number;
    fundamentalSummary: string | null;
    investmentThesis: string | null;
    keyCatalysts: string[] | null;
    keyRisks: string[] | null;
    thesisBreakers: string[] | null;
    groundedIn: string[] | null;
    informationGaps: string[] | null;
  } | null;
  valuation: { resultJson: { currency: string; fairValuePerShare: number } } | null;
}

export default function AIStockDiscoveryPage() {
  const [runs, setRuns] = useState<DiscoveryRun[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateLimit, setCandidateLimit] = useState('8');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [valuationCandidateId, setValuationCandidateId] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const [runResponse, candidateResponse] = await Promise.all([
      fetch('/api/discovery/runs', { signal }),
      fetch('/api/discovery/candidates', { signal }),
    ]);
    const runBody = await runResponse.json().catch(() => ({})) as { runs?: DiscoveryRun[]; error?: string };
    const candidateBody = await candidateResponse.json().catch(() => ({})) as { candidates?: Candidate[]; error?: string };
    if (!runResponse.ok) throw new Error(runBody.error ?? `Discovery runs failed (${runResponse.status})`);
    if (!candidateResponse.ok) throw new Error(candidateBody.error ?? `Candidates failed (${candidateResponse.status})`);
    if (!signal?.aborted) {
      setRuns(runBody.runs ?? []);
      setCandidates(candidateBody.candidates ?? []);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError((cause as Error).message);
    });
    return () => controller.abort();
  }, [load]);

  const hasActiveWork =
    runs.some((run) => run.status === 'queued' || run.status === 'running') ||
    candidates.some((candidate) => candidate.analysisRunStatus === 'queued' || candidate.analysisRunStatus === 'running');

  useEffect(() => {
    if (!hasActiveWork) return;
    const controller = new AbortController();
    const interval = window.setInterval(() => {
      void load(controller.signal).catch(() => undefined);
    }, 4_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [hasActiveWork, load]);

  async function startDiscovery() {
    setBusy('start');
    setError(null);
    try {
      const response = await fetch('/api/discovery/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxCandidatesPerPortfolio: Number(candidateLimit) }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Discovery start failed (${response.status})`);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function decide(candidateId: string, decision: 'approved' | 'rejected' | 'watchlist') {
    setBusy(candidateId);
    setError(null);
    try {
      const response = await fetch('/api/discovery/candidates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId, decision }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Candidate decision failed (${response.status})`);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function retryDiscovery(runId: string) {
    setBusy(`discovery:${runId}`);
    setError(null);
    try {
      const response = await fetch(`/api/discovery/runs?id=${encodeURIComponent(runId)}`, { method: 'PATCH' });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Discovery retry failed (${response.status})`);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function retryAnalysis(externalRunId: string) {
    setBusy(`analysis:${externalRunId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/integrations/agentic/runs?externalRunId=${encodeURIComponent(externalRunId)}`,
        { method: 'PATCH' }
      );
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Analysis retry failed (${response.status})`);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <h1>Thesis-Driven Stock Discovery</h1>
      <p className="sub">Confirmed thesis → provider-backed market universe → AI shortlist → human approval → one-security-at-a-time analysis → deterministic risk and valuation.</p>

      {error && <p className="login-error workflow-error" role="alert">{error}</p>}

      <section className="card workflow-stage">
        <div>
          <h2>1. Start market research</h2>
          <p className="note">Discovery refuses synthetic data and never adds a security to a portfolio. It requires the EODHD provider and your confirmed thesis.</p>
        </div>
        <label className="compact-field">Maximum candidates per portfolio
          <input type="number" min="1" max="20" value={candidateLimit} onChange={(event) => setCandidateLimit(event.target.value)} />
        </label>
        <button className="action-button" type="button" onClick={() => void startDiscovery()} disabled={busy !== null}>
          {busy === 'start' ? 'Starting research…' : 'Find thesis-matched stocks'}
        </button>
      </section>

      <section className="card">
        <h2>Discovery runs</h2>
        {runs.length === 0 ? <p className="note">No market-research run has been started.</p> : (
          <div className="table-scroll"><table>
            <thead><tr><th>Requested</th><th>Provider</th><th>Status</th><th>Candidates</th><th>Issue</th><th>Action</th></tr></thead>
            <tbody>{runs.map((run) => <tr key={run.id}>
              <td>{new Date(run.requestedAt).toLocaleString()}</td>
              <td>{run.provider}</td>
              <td><span className={`badge ${run.status === 'failed' ? 'breach' : run.status === 'completed' ? 'ok' : 'watch'}`}>{run.status}</span></td>
              <td>{run.candidateCount}</td>
              <td className="note">{run.errorMessage ?? '—'}</td>
              <td>{run.status === 'failed' ? <button type="button" onClick={() => void retryDiscovery(run.id)} disabled={busy !== null}>
                {busy === `discovery:${run.id}` ? 'Retrying…' : 'Retry'}
              </button> : '—'}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section>
        <h2 className="section-title">2. Human candidate review</h2>
        {candidates.length === 0 ? <div className="card"><p className="note">Completed discovery candidates will appear here for approval.</p></div> : (
          <div className="candidate-list">{candidates.map((candidate) => {
            const discovery = candidate.discoveryJson;
            const canDecide = candidate.decision === 'pending' || candidate.decision === 'watchlist';
            const isWorking = busy === candidate.id;
            return <article className="card candidate-card" key={candidate.id}>
              <div className="candidate-heading">
                <div>
                  <h3>{candidate.companyName} <span className="note">{candidate.ticker} · {candidate.exchange}</span></h3>
                  <p className="note">{candidate.portfolioName} · {candidate.country ?? '—'} · {candidate.sector ?? '—'} · {candidate.currency}</p>
                </div>
                <div className="candidate-score"><strong>{discovery.thesisAlignmentScore}</strong><span>thesis fit</span></div>
              </div>
              <p>{discovery.rationale}</p>
              <p className="note"><strong>Matched:</strong> {discovery.matchedCriteria.join(' · ') || 'None evidenced'}</p>
              {discovery.violatedCriteria.length > 0 && <p className="caveat"><strong>Conflicts:</strong> {discovery.violatedCriteria.join(' · ')}</p>}
              {discovery.informationGaps.length > 0 && <p className="note"><strong>Gaps:</strong> {discovery.informationGaps.join(' · ')}</p>}
              <p className="note"><strong>Sources:</strong> {discovery.sourceUrls.map((url, index) => <span key={url}>{index ? ' · ' : ''}<a className="text-link" href={url} target="_blank" rel="noreferrer">source {index + 1}</a></span>)}</p>
              <div className="candidate-actions">
                <span className={`badge ${candidate.decision === 'rejected' ? 'breach' : candidate.decision === 'approved' ? 'ok' : 'watch'}`}>{candidate.decision}</span>
                {canDecide && <>
                  <button type="button" onClick={() => void decide(candidate.id, 'approved')} disabled={isWorking}>Approve & analyze</button>
                  <button type="button" onClick={() => void decide(candidate.id, 'watchlist')} disabled={isWorking}>Watchlist</button>
                  <button type="button" className="danger-outline" onClick={() => void decide(candidate.id, 'rejected')} disabled={isWorking}>Reject</button>
                </>}
                {isWorking && <span className="note">Retrieving audited evidence and price history…</span>}
              </div>

              {candidate.externalAnalysisRunId && (
                <div className="analysis-stage">
                  <h3>3. Financial analysis and deterministic risk</h3>
                  <p className="note">Run: {candidate.externalAnalysisRunId} · Status: {candidate.analysisRunStatus ?? candidate.workflowStatus}</p>
                  {candidate.analysisRunStatus === 'failed' && <button type="button" onClick={() => void retryAnalysis(candidate.externalAnalysisRunId!)} disabled={busy !== null}>
                    {busy === `analysis:${candidate.externalAnalysisRunId}` ? 'Retrying analysis…' : 'Retry analysis'}
                  </button>}
                  {candidate.risk && <div className="risk-strip">{candidate.risk.map((metric) => <div key={metric.metricName}>
                    <span>{metric.metricName}</span><strong>{(metric.value * 100).toFixed(2)}%</strong>
                    <details><summary>Method</summary><p>{metric.methodology}</p>{metric.caveat && <p className="caveat">{metric.caveat}</p>}</details>
                  </div>)}</div>}
                  {candidate.analysis ? <>
                    <p><strong>{candidate.analysis.investmentScore}/100</strong> investment score · {candidate.analysis.thesisAlignmentScore}/100 thesis alignment · {(candidate.analysis.confidenceScore * 100).toFixed(0)}% data confidence</p>
                    <p className="note">Quality {candidate.analysis.qualityScore ?? '—'} · Growth {candidate.analysis.growthScore ?? '—'} · Risk severity {candidate.analysis.riskScore ?? '—'} · Dividend {candidate.analysis.dividendScore ?? '—'}</p>
                    <p><strong>Fundamentals:</strong> {candidate.analysis.fundamentalSummary}</p>
                    <p>{candidate.analysis.investmentThesis}</p>
                    <p className="note"><strong>Catalysts:</strong> {(candidate.analysis.keyCatalysts ?? []).join(' · ')}</p>
                    <p className="caveat">Risks: {(candidate.analysis.keyRisks ?? []).join(' · ')}</p>
                    <p className="caveat"><strong>Thesis breakers:</strong> {(candidate.analysis.thesisBreakers ?? []).join(' · ')}</p>
                    <p className="note">Information gaps: {(candidate.analysis.informationGaps ?? []).join(' · ') || 'None recorded'}</p>
                    <details className="analysis-evidence"><summary>Grounding references</summary><ul>{(candidate.analysis.groundedIn ?? []).map((reference) => <li key={reference}><code>{reference}</code></li>)}</ul></details>
                    <button className="action-button" type="button" onClick={() => setValuationCandidateId((current) => current === candidate.id ? null : candidate.id)}>
                      {valuationCandidateId === candidate.id ? 'Close valuation' : candidate.valuation ? 'Review valuation' : 'Prepare DCF valuation'}
                    </button>
                    {candidate.valuation && <p className="security-state">Latest fair-value scenario: {candidate.valuation.resultJson.currency} {candidate.valuation.resultJson.fairValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })} per share.</p>}
                    {valuationCandidateId === candidate.id && <ValuationWorkbench candidateId={candidate.id} onSaved={() => void load()} />}
                  </> : <p className="note">The approved security is processed independently. Valuation unlocks only after its validated analysis returns.</p>}
                </div>
              )}
            </article>;
          })}</div>
        )}
      </section>
    </main>
  );
}
