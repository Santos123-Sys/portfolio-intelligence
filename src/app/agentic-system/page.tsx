'use client';

import { useCallback, useEffect, useState } from 'react';

interface ExternalRun {
  externalRunId: string;
  status: string;
  thesisVersion: string | null;
  requestedAt: string;
  completedAt: string | null;
  importedAt: string | null;
  reportUrl: string | null;
}

export default function AgenticSystemPage() {
  const [runs, setRuns] = useState<ExternalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const loadRuns = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/integrations/agentic/runs', { signal });
    if (!response.ok) throw new Error(`Runs API returned ${response.status}`);
    const data = (await response.json()) as { runs: ExternalRun[] };
    if (!signal?.aborted) setRuns(data.runs);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadRuns(controller.signal)
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadRuns]);

  async function startRun() {
    setStarting(true);
    setError(null);
    try {
      const [thesisResponse, portfolioResponse, positionResponse] = await Promise.all([
        fetch('/api/thesis'),
        fetch('/api/portfolios'),
        fetch('/api/positions'),
      ]);
      if (!thesisResponse.ok || !portfolioResponse.ok || !positionResponse.ok) {
        throw new Error('Unable to prepare the run from current dashboard data');
      }
      const thesisBody = (await thesisResponse.json()) as {
        versions: Array<{ id: string; versionNumber: number; criteriaJson: unknown }>;
      };
      const portfolioBody = (await portfolioResponse.json()) as {
        portfolios: Array<{ id: string; name: string; baseCurrency: string; investmentObjective: string | null }>;
      };
      const positionBody = (await positionResponse.json()) as {
        positions: Array<{ portfolioId: string; ticker: string; exchange: string }>;
      };
      const latestThesis = thesisBody.versions[0];
      if (!latestThesis) throw new Error('Create and confirm an investment thesis before starting analysis');
      if (positionBody.positions.length === 0) throw new Error('No portfolio positions are available for analysis');

      const securityMap = new Map<string, { ticker: string; exchange: string; portfolioId: string }>();
      for (const position of positionBody.positions) {
        securityMap.set(`${position.portfolioId}:${position.exchange}:${position.ticker}`, position);
      }
      const response = await fetch('/api/integrations/agentic/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          thesis: { versionId: latestThesis.id, criteria: latestThesis.criteriaJson },
          securities: [...securityMap.values()],
          portfolios: portfolioBody.portfolios.map((portfolio) => ({
            id: portfolio.id,
            name: portfolio.name,
            baseCurrency: portfolio.baseCurrency,
            investmentObjective: portfolio.investmentObjective ?? '',
          })),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof body.error === 'string' ? body.error : `Start request failed (${response.status})`);
      }
      await loadRuns();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <main>
      <h1>Agentic System Integration</h1>
      <p className="sub">
        The dashboard consumes validated manifests from the separately owned Agentic System.
        It persists results, exposes analysis history and keeps human decisions authoritative.
      </p>

      <div className="grid">
        <section className="card">
          <h2>System boundary</h2>
          <p>External agents extract, analyze and synthesize. Dashboard code validates, stores and renders.</p>
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
          <button type="button" className="action-button" onClick={startRun} disabled={starting}>
            {starting ? 'Starting analysis…' : 'Analyze current portfolios'}
          </button>
        </section>
      </div>

      <section className="card">
        <h2>External analysis runs</h2>
        {loading ? (
          <p className="note">Fetching...</p>
        ) : error ? (
          <p className="caveat">Unable to load external runs: {error}</p>
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
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.externalRunId}>
                    <td><code>{run.externalRunId}</code></td>
                    <td>
                      <span className={`badge ${run.status === 'failed' ? 'breach' : run.status === 'imported' ? 'ok' : 'watch'}`}>
                        {run.status}
                      </span>
                    </td>
                    <td>{run.thesisVersion ? `v${run.thesisVersion}` : '—'}</td>
                    <td>{new Date(run.requestedAt).toLocaleString()}</td>
                    <td>{run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'}</td>
                    <td>{run.importedAt ? new Date(run.importedAt).toLocaleString() : '—'}</td>
                    <td>{run.reportUrl ? <a className="text-link" href={run.reportUrl} target="_blank" rel="noreferrer">Open PDF</a> : '—'}</td>
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
