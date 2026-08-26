'use client';

import { useEffect, useState } from 'react';

interface ExternalRun {
  externalRunId: string;
  status: string;
  thesisVersion: string | null;
  requestedAt: string;
  completedAt: string | null;
  importedAt: string | null;
}

export default function AgenticSystemPage() {
  const [runs, setRuns] = useState<ExternalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/integrations/agentic/runs')
      .then((response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        return response.json();
      })
      .then((data: { runs: ExternalRun[] }) => {
        if (!cancelled) setRuns(data.runs);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
