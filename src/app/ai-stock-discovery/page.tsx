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
  /**
   * The full agent output. It was already being returned by the runs API and
   * simply never read: a run that completed with zero candidates showed
   * "Issue: —", while the agent's own account of why it found nothing sat in
   * this field. An empty result with no stated reason is worse than a failure,
   * because there is nothing to act on.
   */
  resultJson: {
    limitations?: string[];
    marketMandates?: Array<{ portfolioId: string; rationale: string }>;
  } | null;
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

/**
 * What to show in the Issue column.
 *
 * A failed run has an errorMessage. A completed run with candidates has
 * nothing to report. The case that was silently blank is the third one: a run
 * that completed and found nothing. The agent is required to explain coverage
 * and evidence gaps in `limitations`, so that explanation is the issue — it is
 * the only thing that tells the reader whether to widen the thesis, wait for
 * better data, or look at the universe.
 */
function runIssue(run: DiscoveryRun): string {
  if (run.errorMessage) return run.errorMessage;
  if (run.status !== 'completed' || run.candidateCount > 0) return '—';
  const limitations = run.resultJson?.limitations ?? [];
  if (limitations.length > 0) return `No candidates matched. ${limitations.join(' ')}`;
  return 'No candidates matched, and the agent recorded no limitations explaining why. '
    + 'Check that the security universe covers the exchanges your thesis targets.';
}

export default function AIStockDiscoveryPage() {
  const [runs, setRuns] = useState<DiscoveryRun[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateLimit, setCandidateLimit] = useState('6');
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

      {/*
        The three prerequisites below were previously invisible until they were
        violated: discovery-workflow.ts throws for each of them at click time,
        so the only way to learn the required order was to press the button and
        read an error. Stating the sequence up front is the difference between
        a workflow and a guessing game — and each item links to the page that
        satisfies it, so the reader can act without hunting through the nav.
      */}
      <section className="card prerequisites">
        <h2>Before you start</h2>
        <ol className="prerequisite-list">
          <li>
            <strong>Create your portfolios.</strong> Discovery needs at least one Swiss
            Quality or Brazilian Growth portfolio.{' '}
            <a className="text-link" href="/portfolio-setup">Portfolio setup</a>
          </li>
          <li>
            <strong>Confirm your investment thesis.</strong> The thesis defines the criteria
            candidates are matched against, and its mandates must cover the portfolios above.{' '}
            <a className="text-link" href="/investment-thesis">Investment thesis</a>
          </li>
          <li>
            <strong>Configure live research providers.</strong> Discovery needs
            <code>DISCOVERY_PROVIDER=finnhub</code> with <code>FINNHUB_API_KEY</code>; web research
            uses Tavily or Brave. EODHD remains the validation source after your approval.
          </li>
        </ol>
        <p className="note">
          Once all three hold, the numbered stages below run in order: research finds
          candidates, you approve them, and only approved candidates are analysed.
        </p>
      </section>

      <section className="card workflow-stage">
        <div>
          <h2>1. Start market research</h2>
          <p className="note">The workflow builds a 20–50-company universe, applies the available structural filters, adds source-backed web research, and returns a 5–15 candidate shortlist. It never adds a security to a portfolio. EODHD is used only after you approve a candidate.</p>
        </div>
        <label className="compact-field">Maximum candidates per portfolio
          <input type="number" min="1" max="7" value={candidateLimit} onChange={(event) => setCandidateLimit(event.target.value)} />
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
              <td className="note">{runIssue(run)}</td>
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
