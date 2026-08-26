'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ThesisExtractionResult } from '@portfolio-intelligence/agentic-contract';

interface ThesisVersionRow {
  id: string;
  versionNumber: number;
  criteriaJson: unknown;
  effectiveDate: string;
  supersededAt: string | null;
}

interface ExtractionRow {
  id: string;
  externalExtractionId: string;
  status: string;
  requestedVersion: number;
  sourceFileName: string;
  resultJson: ThesisExtractionResult | null;
  errorMessage: string | null;
  requestedAt: string;
  confirmedAt: string | null;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read the selected document'));
    reader.onload = () => {
      const value = String(reader.result);
      const comma = value.indexOf(',');
      comma === -1 ? reject(new Error('Unable to encode the selected document')) : resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function InvestmentThesisPage() {
  const [versions, setVersions] = useState<ThesisVersionRow[]>([]);
  const [extractions, setExtractions] = useState<ExtractionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [criteriaDraft, setCriteriaDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingExtractionIds = extractions
    .filter((item) => item.status === 'queued' || item.status === 'running')
    .map((item) => item.externalExtractionId)
    .sort()
    .join('|');

  const load = useCallback(async (signal?: AbortSignal) => {
    const [versionsResponse, extractionsResponse] = await Promise.all([
      fetch('/api/thesis', { signal }),
      fetch('/api/integrations/agentic/thesis-extractions', { signal }),
    ]);
    if (!versionsResponse.ok || !extractionsResponse.ok) throw new Error('Unable to load thesis workflow');
    const versionsBody = await versionsResponse.json() as { versions: ThesisVersionRow[] };
    const extractionsBody = await extractionsResponse.json() as { extractions: ExtractionRow[] };
    if (!signal?.aborted) {
      setVersions(versionsBody.versions);
      setExtractions(extractionsBody.extractions);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError((cause as Error).message);
    });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!pendingExtractionIds) return;
    const pendingIds = pendingExtractionIds.split('|');
    const interval = window.setInterval(async () => {
      const refreshed = await Promise.all(pendingIds.map(async (externalExtractionId) => {
        const response = await fetch(`/api/integrations/agentic/thesis-extractions?externalExtractionId=${encodeURIComponent(externalExtractionId)}`);
        if (!response.ok) return null;
        const body = await response.json() as { extraction: ExtractionRow };
        return body.extraction;
      }));
      setExtractions((current) => current.map((item) =>
        refreshed.find((candidate) => candidate?.externalExtractionId === item.externalExtractionId) ?? item
      ));
    }, 3_000);
    return () => window.clearInterval(interval);
  }, [pendingExtractionIds]);

  const selected = extractions.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (selected?.status === 'completed' && selected.resultJson && !criteriaDraft) {
      setCriteriaDraft(JSON.stringify(selected.resultJson.criteria, null, 2));
    }
  }, [selected, criteriaDraft]);

  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const mimeType = file.type === 'application/pdf'
        ? 'application/pdf'
        : file.name.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain';
      const response = await fetch('/api/integrations/agentic/thesis-extractions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType, contentBase64: await fileToBase64(file) }),
      });
      const body = await response.json().catch(() => ({})) as { extraction?: ExtractionRow; error?: string };
      if (!response.ok || !body.extraction) throw new Error(body.error ?? `Upload failed (${response.status})`);
      setExtractions((current) => [body.extraction!, ...current]);
      setSelectedId(body.extraction.id);
      setCriteriaDraft('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function review(extraction: ExtractionRow) {
    setSelectedId(extraction.id);
    setCriteriaDraft(extraction.resultJson ? JSON.stringify(extraction.resultJson.criteria, null, 2) : '');
    setError(null);
  }

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const criteriaJson = JSON.parse(criteriaDraft) as unknown;
      const response = await fetch('/api/thesis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ externalExtractionId: selected.externalExtractionId, criteriaJson }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Confirmation failed (${response.status})`);
      setSelectedId(null);
      setCriteriaDraft('');
      await load();
    } catch (cause) {
      setError(cause instanceof SyntaxError ? 'Criteria must be valid JSON' : (cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function retry(extraction: ExtractionRow) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/integrations/agentic/thesis-extractions?externalExtractionId=${encodeURIComponent(extraction.externalExtractionId)}`, {
        method: 'PATCH',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Retry failed (${response.status})`);
      }
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Investment Thesis</h1>
      <p className="sub">Extract a document, review every ambiguity, then explicitly confirm the canonical criteria.</p>

      {error && <p className="caveat" role="alert">{error}</p>}

      <section className="card">
        <h2>1. Submit source document</h2>
        <p className="note">PDF, plain text or Markdown, up to 50 MB. Extraction never becomes canonical automatically.</p>
        <label className="action-button" style={{ display: 'inline-block', cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Working…' : 'Choose thesis document'}
          <input
            type="file"
            accept="application/pdf,text/plain,text/markdown,.md,.txt"
            hidden
            disabled={busy}
            onChange={(event) => void upload(event.target.files?.[0] ?? null)}
          />
        </label>
      </section>

      <section className="card">
        <h2>2. Extraction review queue</h2>
        {extractions.length === 0 ? <p className="note">No extraction submitted yet.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Document</th><th>Version</th><th>Status</th><th>Submitted</th><th>Action</th></tr></thead>
              <tbody>{extractions.map((extraction) => (
                <tr key={extraction.id}>
                  <td>{extraction.sourceFileName}</td>
                  <td>v{extraction.requestedVersion}</td>
                  <td><span className={`badge ${extraction.status === 'failed' ? 'breach' : extraction.status === 'completed' ? 'ok' : 'watch'}`}>{extraction.status}</span></td>
                  <td>{new Date(extraction.requestedAt).toLocaleString()}</td>
                  <td>
                    {extraction.status === 'completed' && !extraction.confirmedAt && (
                      <button className="action-button" type="button" onClick={() => review(extraction)}>Review</button>
                    )}
                    {extraction.status === 'failed' && (
                      <button className="action-button" type="button" onClick={() => void retry(extraction)} disabled={busy}>Retry</button>
                    )}
                    {extraction.confirmedAt && <span className="note">Confirmed</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {selected?.resultJson && (
        <section className="card">
          <h2>3. Human confirmation</h2>
          <p className="note">Extraction confidence: {(selected.resultJson.extractionConfidence * 100).toFixed(0)}%. Edit the criteria if needed, then confirm.</p>
          {selected.resultJson.ambiguousPoints.length > 0 && (
            <div className="caveat">
              <strong>Ambiguities requiring judgment</strong>
              <ul>{selected.resultJson.ambiguousPoints.map((point, index) => (
                <li key={`${point.location}-${index}`}>{point.location}: {point.issue} — “{point.sourceExcerpt}”</li>
              ))}</ul>
            </div>
          )}
          {selected.resultJson.unmappedContent.length > 0 && (
            <p className="note">Unmapped content: {selected.resultJson.unmappedContent.join(' · ')}</p>
          )}
          <label htmlFor="criteria-json"><strong>Canonical criteria JSON</strong></label>
          <textarea
            id="criteria-json"
            value={criteriaDraft}
            onChange={(event) => setCriteriaDraft(event.target.value)}
            rows={24}
            style={{ width: '100%', marginTop: '0.75rem', fontFamily: 'monospace' }}
          />
          <button className="action-button" type="button" onClick={() => void confirm()} disabled={busy || !criteriaDraft}>
            Confirm thesis version {selected.requestedVersion}
          </button>
        </section>
      )}

      <section className="card">
        <h2>Confirmed versions</h2>
        {versions.length === 0 ? <p className="note">No thesis version has been confirmed.</p> : (
          <div className="grid">{versions.map((thesis) => (
            <article className="card" key={thesis.id}>
              <h3>Version {thesis.versionNumber}</h3>
              <p className="note">Effective: {new Date(thesis.effectiveDate).toLocaleString()}</p>
              <span className={`badge ${thesis.supersededAt ? 'watch' : 'ok'}`}>{thesis.supersededAt ? 'Superseded' : 'Active'}</span>
              <pre style={{ whiteSpace: 'pre-wrap', marginTop: '1rem', color: 'var(--muted)', fontSize: '0.75rem' }}>
                {JSON.stringify(thesis.criteriaJson, null, 2)}
              </pre>
            </article>
          ))}</div>
        )}
      </section>
    </main>
  );
}
