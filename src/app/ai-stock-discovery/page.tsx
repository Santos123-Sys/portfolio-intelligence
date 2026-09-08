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
  maxCandidatesPerPortfolio: number | null;
  portfolioCandidateCounts: Array<{
    portfolioId: string;
    portfolioName: string;
    count: number;
  }>;
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

interface ResearchFramework {
  coverageRationale: string;
  marketContext: string[];
  sectorDrivers: string[];
  companyDrivers: string[];
  criticalValuationDrivers: string[];
  monitoringTriggers: string[];
  evidenceQuality: 'limited' | 'developing' | 'sufficient';
  scenarioReadiness: 'not_ready' | 'qualitative_only' | 'driver_ready';
}

interface Candidate {
  id: string;
  runId: string;
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
  analysisRunError: string | null;
  analysisErrorMessage: string | null;
  reportUrl: string | null;
  analysisMode: 'full_fundamentals' | 'limited_research_risk' | null;
  dcfLocked: boolean;
  dcfLockReason: string | null;
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
    researchFramework: ResearchFramework | null;
    groundedIn: string[] | null;
    informationGaps: string[] | null;
  } | null;
  valuation: { resultJson: { currency: string; fairValuePerShare: number } } | null;
}

function friendlyAnalysisStatus(candidate: Candidate): {
  label: string;
  badgeClass: 'ok' | 'watch' | 'breach';
  description: string;
} {
  if (candidate.workflowStatus === 'analysis_failed' || candidate.analysisRunStatus === 'failed') {
    return {
      label: 'Needs attention',
      badgeClass: 'breach',
      description: 'The analysis stopped before a validated result was produced. Review the message below and retry.',
    };
  }
  if (candidate.reportUrl || (candidate.analysis && (candidate.analysisRunStatus === 'completed' || candidate.analysisRunStatus === 'imported'))) {
    return {
      label: 'Report ready',
      badgeClass: 'ok',
      description: 'The research evidence and deterministic price-risk checks are ready for your review.',
    };
  }
  if (candidate.analysisRunStatus === 'running') {
    return {
      label: 'Analysis in progress',
      badgeClass: 'watch',
      description: 'The research agent is assessing thesis fit, evidence quality, catalysts, and downside risks.',
    };
  }
  if (candidate.workflowStatus === 'analysis_preparing') {
    return {
      label: 'Preparing evidence',
      badgeClass: 'watch',
      description: 'Approval is saved. Validated price history and source-backed research are being prepared.',
    };
  }
  return {
    label: 'Waiting to begin',
    badgeClass: 'watch',
    description: 'The analysis request is queued and will start automatically. You can leave this page while it runs.',
  };
}

function friendlyRiskMetric(metricName: string): string {
  const labels: Record<string, string> = {
    Volatility: 'Annualized volatility',
    MaxDrawdown: 'Maximum drawdown',
    VaR_95_1d_Historical: '1-day VaR (historical, 95%)',
    VaR_95_1d_Parametric: '1-day VaR (parametric, 95%)',
  };
  return labels[metricName] ?? metricName.replaceAll('_', ' ');
}

function frameworkLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [candidateListLoading, setCandidateListLoading] = useState(false);
  const [candidateLimit, setCandidateLimit] = useState('6');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidateErrors, setCandidateErrors] = useState<Record<string, string>>({});
  const [valuationCandidateId, setValuationCandidateId] = useState<string | null>(null);

  const loadRuns = useCallback(async (signal?: AbortSignal) => {
    const runResponse = await fetch('/api/discovery/runs', { signal });
    const runBody = await runResponse.json().catch(() => ({})) as { runs?: DiscoveryRun[]; error?: string };
    if (!runResponse.ok) throw new Error(runBody.error ?? `Discovery runs failed (${runResponse.status})`);
    if (!signal?.aborted) setRuns(runBody.runs ?? []);
  }, []);

  const loadCandidates = useCallback(async (runId: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/discovery/candidates?runId=${encodeURIComponent(runId)}`, { signal });
    const body = await response.json().catch(() => ({})) as { candidates?: Candidate[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? `Candidates failed (${response.status})`);
    if (!signal?.aborted) setCandidates(body.candidates ?? []);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadRuns(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError((cause as Error).message);
    });
    return () => controller.abort();
  }, [loadRuns]);

  useEffect(() => {
    if (!selectedRunId) {
      setCandidates([]);
      setCandidateListLoading(false);
      return;
    }
    const controller = new AbortController();
    setCandidateListLoading(true);
    setCandidates([]);
    void loadCandidates(selectedRunId, controller.signal)
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCandidateListLoading(false);
      });
    return () => controller.abort();
  }, [loadCandidates, selectedRunId]);

  const hasActiveWork =
    runs.some((run) => run.status === 'queued' || run.status === 'running') ||
    candidates.some((candidate) =>
      candidate.workflowStatus === 'analysis_preparing' ||
      candidate.analysisRunStatus === 'queued' ||
      candidate.analysisRunStatus === 'running'
    );

  useEffect(() => {
    if (!hasActiveWork) return;
    const controller = new AbortController();
    const interval = window.setInterval(() => {
      void Promise.all([
        loadRuns(controller.signal),
        selectedRunId ? loadCandidates(selectedRunId, controller.signal) : Promise.resolve(),
      ]).catch(() => undefined);
    }, 4_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [hasActiveWork, loadCandidates, loadRuns, selectedRunId]);

  async function startDiscovery() {
    setBusy('start');
    setError(null);
    setSelectedRunId(null);
    setCandidates([]);
    setShowRunHistory(false);
    try {
      const response = await fetch('/api/discovery/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxCandidatesPerPortfolio: Number(candidateLimit) }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Discovery start failed (${response.status})`);
      await loadRuns();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function decide(candidateId: string, decision: 'approved' | 'rejected' | 'watchlist') {
    setBusy(candidateId);
    setError(null);
    setCandidateErrors((current) => {
      const next = { ...current };
      delete next[candidateId];
      return next;
    });
    try {
      const response = await fetch('/api/discovery/candidates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId, decision }),
      });
      const body = await response.json().catch(() => ({})) as { candidate?: Partial<Candidate> & { id: string }; error?: string };
      if (!response.ok) throw new Error(body.error ?? `Candidate decision failed (${response.status})`);
      if (body.candidate) {
        setCandidates((current) => current.map((candidate) =>
          candidate.id === candidateId ? { ...candidate, ...body.candidate } : candidate
        ));
      }
      if (selectedRunId) await loadCandidates(selectedRunId);
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message);
      setCandidateErrors((current) => ({ ...current, [candidateId]: message }));
    } finally {
      setBusy(null);
    }
  }

  async function retryDiscovery(runId: string) {
    setBusy(`discovery:${runId}`);
    setError(null);
    setSelectedRunId(null);
    setCandidates([]);
    setShowRunHistory(false);
    try {
      const response = await fetch(`/api/discovery/runs?id=${encodeURIComponent(runId)}`, { method: 'PATCH' });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Discovery retry failed (${response.status})`);
      await loadRuns();
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
      if (selectedRunId) await loadCandidates(selectedRunId);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function toggleCandidateReview(runId: string) {
    setError(null);
    setCandidateErrors({});
    setValuationCandidateId(null);
    setSelectedRunId((current) => current === runId ? null : runId);
  }

  const latestRun = runs[0] ?? null;
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;

  return (
    <main>
      <h1>Thesis-Driven Stock Discovery</h1>
      <p className="sub">Confirmed thesis → provider-backed market universe → AI shortlist → human approval → source-backed research analysis and deterministic price risk.</p>

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
            uses Tavily or Brave. Finnhub is discovery-only. After approval, EODHD supplies
            price history for deterministic risk; structured fundamentals are not requested.
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
        <label className="compact-field">Maximum candidates in each portfolio
          <input type="number" min="1" max="7" value={candidateLimit} onChange={(event) => setCandidateLimit(event.target.value)} />
          <span>Applied separately to every eligible portfolio, not to the combined run.</span>
        </label>
        <button className="action-button" type="button" onClick={() => void startDiscovery()} disabled={busy !== null}>
          {busy === 'start' ? 'Starting research…' : 'Find thesis-matched stocks'}
        </button>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Discovery runs</h2>
            <p className="note">Run history stays collapsed. Open it only when you want to review or retry a specific run.</p>
          </div>
          {runs.length > 0 && <button
            className="action-button"
            type="button"
            aria-expanded={showRunHistory}
            aria-controls="discovery-run-history"
            onClick={() => setShowRunHistory((current) => !current)}
          >
            {showRunHistory ? 'Hide run history' : `Show run history (${runs.length})`}
          </button>}
        </div>
        {runs.length === 0 ? <p className="note">No market-research run has been started.</p> : !showRunHistory ? (
          <div className="latest-run-summary" aria-live="polite">
            <p>
              <strong>Latest run:</strong> {new Date(latestRun!.requestedAt).toLocaleString()} ·{' '}
              <span className={`badge ${latestRun!.status === 'failed' ? 'breach' : latestRun!.status === 'completed' ? 'ok' : 'watch'}`}>{latestRun!.status}</span>{' '}
              · {latestRun!.candidateCount} candidates
            </p>
            {latestRun!.status === 'completed' && latestRun!.candidateCount > 0 && <button
              className="action-button"
              type="button"
              onClick={() => toggleCandidateReview(latestRun!.id)}
            >
              {selectedRunId === latestRun!.id ? 'Hide candidates' : 'Review latest candidates'}
            </button>}
          </div>
        ) : (
          <div className="table-scroll" id="discovery-run-history"><table>
            <thead><tr><th>Requested</th><th>Provider</th><th>Status</th><th>Candidates by portfolio</th><th>Issue</th><th>Action</th></tr></thead>
            <tbody>{runs.map((run) => <tr key={run.id}>
              <td>{new Date(run.requestedAt).toLocaleString()}</td>
              <td>{run.provider}</td>
              <td><span className={`badge ${run.status === 'failed' ? 'breach' : run.status === 'completed' ? 'ok' : 'watch'}`}>{run.status}</span></td>
              <td>
                <strong>{run.candidateCount} total</strong>
                {run.portfolioCandidateCounts.length > 0 && (
                  <ul className="run-candidate-breakdown">
                    {run.portfolioCandidateCounts.map((portfolio) => <li key={portfolio.portfolioId}>
                      {portfolio.portfolioName}: {portfolio.count}/{run.maxCandidatesPerPortfolio ?? '—'}
                    </li>)}
                  </ul>
                )}
              </td>
              <td className="note">{runIssue(run)}</td>
              <td>{run.status === 'failed' ? <button type="button" onClick={() => void retryDiscovery(run.id)} disabled={busy !== null}>
                {busy === `discovery:${run.id}` ? 'Retrying…' : 'Retry'}
              </button> : run.status === 'completed' && run.candidateCount > 0 ? <button type="button" onClick={() => toggleCandidateReview(run.id)}>
                {selectedRunId === run.id ? 'Hide candidates' : 'Review candidates'}
              </button> : '—'}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section>
        <div className="section-heading candidate-review-heading">
          <div>
            <h2 className="section-title">2. Human candidate review</h2>
            {selectedRun && <p className="note">Showing only the {selectedRun.candidateCount} candidates found by the run requested {new Date(selectedRun.requestedAt).toLocaleString()}.</p>}
          </div>
          {selectedRunId && <button className="action-button" type="button" onClick={() => setSelectedRunId(null)}>Hide candidates</button>}
        </div>
        {!selectedRunId ? <div className="card"><p className="note">Candidate results are hidden. Review the latest run above, or open run history to choose an earlier run.</p></div>
          : candidateListLoading ? <div className="card"><p className="note">Loading this run&apos;s candidates…</p></div>
          : candidates.length === 0 ? <div className="card"><p className="note">This market-research run returned no candidates.</p></div> : (
          <div className="candidate-list">{candidates.map((candidate) => {
            const discovery = candidate.discoveryJson;
            const canDecide = candidate.decision === 'pending' || candidate.decision === 'watchlist';
            const isWorking = busy === candidate.id;
            const analysisStatus = friendlyAnalysisStatus(candidate);
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
                  <button type="button" onClick={() => void decide(candidate.id, 'approved')} disabled={isWorking}>{isWorking ? 'Approving…' : 'Approve & analyze'}</button>
                  <button type="button" onClick={() => void decide(candidate.id, 'watchlist')} disabled={isWorking}>Watchlist</button>
                  <button type="button" className="danger-outline" onClick={() => void decide(candidate.id, 'rejected')} disabled={isWorking}>Reject</button>
                </>}
                {isWorking && <span className="note">Preparing source-backed research and validated price history…</span>}
                {candidateErrors[candidate.id] && <p className="caveat" role="alert">{candidateErrors[candidate.id]}</p>}
              </div>

              {candidate.decision === 'approved' && (
                <div className="analysis-stage">
                  <div className="analysis-stage-heading">
                    <div>
                      <p className="analysis-eyebrow">Approved investment research</p>
                      <h3>3. Research and risk assessment</h3>
                    </div>
                    <span className={`badge ${analysisStatus.badgeClass}`}>{analysisStatus.label}</span>
                  </div>
                  <p className="analysis-status-copy" aria-live="polite">{analysisStatus.description}</p>
                  {candidate.analysisMode === 'limited_research_risk' && <div className="analysis-scope">
                    <strong>Evidence scope</strong>
                    <p>This assessment combines source-backed company research with EODHD price-risk metrics. Structured financial statements are not included, so DCF valuation remains locked.</p>
                  </div>}
                  {candidate.workflowStatus === 'analysis_failed' && <p className="caveat" role="alert">{candidate.analysisErrorMessage ?? candidate.analysisRunError ?? 'Analysis failed. Retry from this candidate card.'}</p>}
                  {candidate.workflowStatus === 'analysis_failed' && !candidate.externalAnalysisRunId && <button className="action-button" type="button" onClick={() => void decide(candidate.id, 'approved')} disabled={busy !== null}>
                    {busy === candidate.id ? 'Retrying preparation…' : 'Retry analysis preparation'}
                  </button>}
                  {candidate.analysisRunStatus === 'failed' && candidate.externalAnalysisRunId && <button className="action-button" type="button" onClick={() => void retryAnalysis(candidate.externalAnalysisRunId!)} disabled={busy !== null}>
                    {busy === `analysis:${candidate.externalAnalysisRunId}` ? 'Retrying analysis…' : 'Retry analysis'}
                  </button>}
                  {candidate.risk && <div className="risk-strip">{candidate.risk.map((metric) => <div key={metric.metricName}>
                    <span>{friendlyRiskMetric(metric.metricName)}</span><strong>{(metric.value * 100).toFixed(2)}%</strong>
                    <details><summary>How it is calculated</summary><p>{metric.methodology}</p>{metric.caveat && <p className="caveat">{metric.caveat}</p>}</details>
                  </div>)}</div>}
                  {candidate.analysis ? <>
                    <div className="analysis-score-summary">
                      <div><strong>{candidate.analysis.investmentScore}</strong><span>Investment score</span></div>
                      <div><strong>{candidate.analysis.thesisAlignmentScore}</strong><span>Thesis alignment</span></div>
                      <div><strong>{(candidate.analysis.confidenceScore * 100).toFixed(0)}%</strong><span>Evidence confidence</span></div>
                    </div>
                    {candidate.analysisMode === 'limited_research_risk'
                      ? <p className="note">Risk severity {candidate.analysis.riskScore ?? '—'} · Financial characteristic scores are withheld in limited-data mode.</p>
                      : <p className="note">Quality {candidate.analysis.qualityScore ?? '—'} · Growth {candidate.analysis.growthScore ?? '—'} · Risk severity {candidate.analysis.riskScore ?? '—'} · Dividend {candidate.analysis.dividendScore ?? '—'}</p>}
                    <div className="analysis-decision">
                      <h4>Decision view</h4>
                      <p>{candidate.analysis.investmentThesis}</p>
                    </div>
                    <p><strong>Evidence coverage:</strong> {candidate.analysis.fundamentalSummary}</p>
                    <p className="note"><strong>Catalysts:</strong> {(candidate.analysis.keyCatalysts ?? []).join(' · ')}</p>
                    <p className="caveat"><strong>Principal risks:</strong> {(candidate.analysis.keyRisks ?? []).join(' · ')}</p>
                    <p className="caveat"><strong>Thesis breakers:</strong> {(candidate.analysis.thesisBreakers ?? []).join(' · ')}</p>
                    <p className="note"><strong>Information gaps:</strong> {(candidate.analysis.informationGaps ?? []).join(' · ') || 'None recorded'}</p>
                    {candidate.analysis.researchFramework && <section className="research-framework" aria-label="Research framework">
                      <div className="research-framework-heading">
                        <div>
                          <h4>Research framework</h4>
                          <p>How this security fits the coverage process and what must be monitored next.</p>
                        </div>
                        <div className="research-framework-badges">
                          <span className="badge">Evidence: {frameworkLabel(candidate.analysis.researchFramework.evidenceQuality)}</span>
                          <span className="badge">Scenarios: {frameworkLabel(candidate.analysis.researchFramework.scenarioReadiness)}</span>
                        </div>
                      </div>
                      <p><strong>Coverage rationale:</strong> {candidate.analysis.researchFramework.coverageRationale}</p>
                      <div className="research-framework-grid">
                        <div><strong>Market context</strong><p>{candidate.analysis.researchFramework.marketContext.join(' · ') || 'Not evidenced in the current research pack.'}</p></div>
                        <div><strong>Sector drivers</strong><p>{candidate.analysis.researchFramework.sectorDrivers.join(' · ') || 'Not evidenced in the current research pack.'}</p></div>
                        <div><strong>Company drivers</strong><p>{candidate.analysis.researchFramework.companyDrivers.join(' · ') || 'Not evidenced in the current research pack.'}</p></div>
                        <div><strong>Valuation drivers</strong><p>{candidate.analysis.researchFramework.criticalValuationDrivers.join(' · ') || 'Not ready without further validated financial evidence.'}</p></div>
                      </div>
                      <p className="note"><strong>Monitoring triggers:</strong> {candidate.analysis.researchFramework.monitoringTriggers.join(' · ')}</p>
                    </section>}
                    {candidate.reportUrl && <div className="analysis-report-cta">
                      <div>
                        <strong>Professional investment report</strong>
                        <p>Open the complete decision summary, scorecards, catalysts, risks, limitations, and disclosure in a presentation-ready PDF.</p>
                      </div>
                      <a className="action-button inline-action" href={candidate.reportUrl} target="_blank" rel="noreferrer">Open PDF report</a>
                    </div>}
                    {candidate.dcfLocked ? (
                      <p className="caveat"><strong>DCF locked.</strong> {candidate.dcfLockReason}</p>
                    ) : <>
                      <button className="action-button" type="button" onClick={() => setValuationCandidateId((current) => current === candidate.id ? null : candidate.id)}>
                        {valuationCandidateId === candidate.id ? 'Close valuation' : candidate.valuation ? 'Review valuation' : 'Prepare DCF valuation'}
                      </button>
                      {candidate.valuation && <p className="security-state">Latest fair-value scenario: {candidate.valuation.resultJson.currency} {candidate.valuation.resultJson.fairValuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })} per share.</p>}
                      {valuationCandidateId === candidate.id && <ValuationWorkbench candidateId={candidate.id} onSaved={() => {
                        if (selectedRunId) void loadCandidates(selectedRunId);
                      }} />}
                    </>}
                    <details className="analysis-evidence"><summary>Audit and processing details</summary>
                      <p>Status: {candidate.analysisRunStatus ?? candidate.workflowStatus}</p>
                      {candidate.externalAnalysisRunId && <p>Internal reference: <code>{candidate.externalAnalysisRunId}</code></p>}
                      <p>{(candidate.analysis.groundedIn ?? []).length} evidence references retained.</p>
                      <ul>{(candidate.analysis.groundedIn ?? []).map((reference) => <li key={reference}><code>{reference}</code></li>)}</ul>
                    </details>
                  </> : <>
                    {candidate.reportUrl && <div className="analysis-report-cta">
                      <div>
                        <strong>Professional investment report</strong>
                        <p>The report is ready. It can be reviewed while the dashboard finishes importing its structured analysis.</p>
                      </div>
                      <a className="action-button inline-action" href={candidate.reportUrl} target="_blank" rel="noreferrer">Open PDF report</a>
                    </div>}
                    <p className="note">The approved security is processed independently. Limited-data analysis uses research evidence and price risk; DCF remains locked without structured statements.</p>
                  </>}
                </div>
              )}
            </article>;
          })}</div>
        )}
      </section>
    </main>
  );
}
