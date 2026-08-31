'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface ExternalRun {
  externalRunId: string;
  status: string;
  thesisVersion: string | null;
  requestedAt: string;
  completedAt: string | null;
  importedAt: string | null;
  reportUrl: string | null;
  errorMessage: string | null;
}

interface AgenticReadiness {
  ready: boolean;
  thesisVersion: number | null;
  portfolioCount: number;
  positionCount: number;
  issues: string[];
}

export default function AgenticSystemPage() {
  const [runs, setRuns] = useState<ExternalRun[]>([]);
  const [readiness, setReadiness] = useState<AgenticReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const loadRuns = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/integrations/agentic/runs', { signal });
    if (!response.ok) throw new Error(`Runs API returned ${response.status}`);
    const data = (await response.json()) as { runs: ExternalRun[]; readiness: AgenticReadiness };
    if (!signal?.aborted) {
      setRuns(data.runs);
      setReadiness(data.readiness);
      setLoadError(null);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadRuns(controller.signal)
      .catch((cause) => {
        if (!controller.signal.aborted) setLoadError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    const interval = window.setInterval(() => {
      void loadRuns(controller.signal).catch(() => undefined);
    }, 5_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [loadRuns]);

  async function startRun() {
    setStarting(true);
    setActionError(null);
    try {
      const response = await fetch('/api/integrations/agentic/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof body.error === 'string' ? body.error : `Start request failed (${response.status})`);
      }
      await loadRuns();
    } catch (cause) {
      setActionError((cause as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function retryRun(externalRunId: string) {
    setActionError(null);
    const response = await fetch(`/api/integrations/agentic/runs?externalRunId=${encodeURIComponent(externalRunId)}`, {
      method: 'PATCH',
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setActionError(body.error ?? `Retry failed (${response.status})`);
      return;
    }
    await loadRuns();
  }

  return (
    <main>
      <h1>Existing-Holdings Analysis</h1>
      <p className="sub">
        Review positions you already own. For new ideas, start with Thesis and Discover; this page is not a prerequisite for market research.
      </p>

      <div className="grid">
        <section className="card">
          <h2>System boundary</h2>
          <p>The private worker extracts, analyzes and synthesizes. Dashboard code validates, stores and renders.</p>
          <p className="note">The dashboard does not execute model prompts or calculate figures from AI prose.</p>
        </section>

        <section className="card">
          <h2>Handoff contract</h2>
          <p className="note">
            externalRunId → manifest.json → per-security analyses → portfolio synthesis → optional PDF report
          </p>
          <p className="note">Duplicate run IDs are idempotent; changed payloads under the same ID are rejected.</p>
        </section>

        <section className="card">
          <h2>Decision authority</h2>
          <p>Imported analysis informs candidate review and security detail. It cannot modify holdings or execute trades.</p>
          <p className="note">Accept, reject and watchlist decisions remain explicit human mutations.</p>
          {readiness?.ready ? (
            <p className="security-state">Ready: thesis v{readiness.thesisVersion}, {readiness.portfolioCount} portfolio(s), {readiness.positionCount} position(s).</p>
          ) : readiness ? (
            <>
              <p className="caveat">Existing-holdings analysis prerequisites are incomplete.</p>
              <ul className="note">{readiness.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
              <Link className="text-link" href="/portfolio-setup">Record existing holdings</Link>
            </>
          ) : <p className="note">Checking analysis readiness…</p>}
          {actionError && <p className="login-error" role="alert">{actionError}</p>}
          <button
            type="button"
            className="action-button"
            onClick={startRun}
            disabled={starting || !readiness?.ready}
            data-busy={starting ? 'true' : 'false'}
          >
            {starting ? 'Starting analysis…' : 'Analyze current portfolios'}
          </button>
        </section>
      </div>

      <section className="card">
        <h2>External analysis runs</h2>
        {loading ? (
          <p className="note">Fetching...</p>
        ) : loadError ? (
          <p className="caveat">Unable to load external runs: {loadError}</p>
        ) : runs.length === 0 ? (
          <p className="note">
            No external manifests imported yet. Completed runs appear here after the Agentic System posts to
            /api/integrations/agentic/import.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>External run</th>
                  <th>Status</th>
                  <th>Thesis</th>
                  <th>Requested</th>
                  <th>Completed</th>
                  <th>Imported</th>
                  <th>Report</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.externalRunId}>
                    <td><code>{run.externalRunId}</code></td>
                    <td title={run.errorMessage ?? undefined}>
                      <span className={`badge ${run.status === 'failed' ? 'breach' : run.status === 'imported' ? 'ok' : 'watch'}`}>
                        {run.status}
                      </span>
                    </td>
                    <td>{run.thesisVersion ? `v${run.thesisVersion}` : '—'}</td>
                    <td>{new Date(run.requestedAt).toLocaleString()}</td>
                    <td>{run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'}</td>
                    <td>{run.importedAt ? new Date(run.importedAt).toLocaleString() : '—'}</td>
                    <td>{run.reportUrl ? <a className="text-link" href={run.reportUrl} target="_blank" rel="noreferrer">Open PDF</a> : '—'}</td>
                    {run.status === 'failed' ? (
                      <td>
                        <button type="button" className="action-button" onClick={() => void retryRun(run.externalRunId)}>
                          Retry
                        </button>
                      </td>
                    ) : <td>—</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
