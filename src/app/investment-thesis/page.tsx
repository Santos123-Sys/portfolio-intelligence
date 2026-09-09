'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ThesisCriteria, ThesisExtractionResult } from '@portfolio-intelligence/agentic-contract';
import { canDismissThesisExtraction } from '@/lib/thesis-extraction-lifecycle';
import { normalizeThesisMandateCurrency } from '@/lib/thesis-currency';

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
      if (comma === -1) reject(new Error('Unable to encode the selected document'));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function InvestmentThesisPage() {
  const router = useRouter();
  const [versions, setVersions] = useState<ThesisVersionRow[]>([]);
  const [extractions, setExtractions] = useState<ExtractionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [criteriaDraft, setCriteriaDraft] = useState<ThesisCriteria | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitionNotice, setTransitionNotice] = useState<string | null>(null);
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
      setCriteriaDraft(structuredClone(selected.resultJson.criteria));
    }
  }, [selected, criteriaDraft]);

  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const mimeType = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : file.name.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain';
      const maxBytes = mimeType === 'application/pdf' ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
      if (file.size < 1 || file.size > maxBytes) {
        throw new Error(mimeType === 'application/pdf'
          ? 'PDF documents must contain data and be no larger than 10 MB'
          : 'Text documents must contain data and be no larger than 2 MB');
      }
      const response = await fetch('/api/integrations/agentic/thesis-extractions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType, contentBase64: await fileToBase64(file) }),
      });
      const body = await response.json().catch(() => ({})) as { extraction?: ExtractionRow; error?: string };
      if (!response.ok || !body.extraction) throw new Error(body.error ?? `Upload failed (${response.status})`);
      setExtractions((current) => [body.extraction!, ...current]);
      setSelectedId(body.extraction.id);
      setCriteriaDraft(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function review(extraction: ExtractionRow) {
    setSelectedId(extraction.id);
    setCriteriaDraft(extraction.resultJson ? structuredClone(extraction.resultJson.criteria) : null);
    setError(null);
  }

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setTransitionNotice(null);
    try {
      if (!criteriaDraft) throw new Error('No extracted criteria are available to confirm');
      const response = await fetch('/api/thesis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ externalExtractionId: selected.externalExtractionId, criteriaJson: criteriaDraft }),
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        discoveryTransition?: {
          status: 'started' | 'existing' | 'blocked';
          runId?: string;
          runStatus?: string;
          errorMessage?: string;
        };
      };
      if (!response.ok) throw new Error(body.error ?? `Confirmation failed (${response.status})`);
      setSelectedId(null);
      setCriteriaDraft(null);
      if (body.discoveryTransition?.status === 'started' || body.discoveryTransition?.status === 'existing') {
        router.push('/ai-stock-discovery');
      } else {
        setTransitionNotice(
          `The thesis was confirmed, but market research did not start: ${body.discoveryTransition?.errorMessage ?? 'the transition was not accepted'}. ` +
          'Correct the stated prerequisite, then use “Find thesis-matched stocks” on the discovery page.'
        );
        await load();
      }
    } catch (cause) {
      setError((cause as Error).message);
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

  async function dismiss(extraction: ExtractionRow) {
    const dismissalNotice = extraction.confirmedAt
      ? 'The linked confirmed thesis version and extracted result will also be excluded.'
      : extraction.status === 'queued' || extraction.status === 'running'
        ? 'This does not cancel work already accepted by the agentic service, but its result will remain excluded from this dashboard.'
        : 'Its extracted criteria will not become canonical.';
    if (!window.confirm(`Dismiss ${extraction.sourceFileName} from the review queue? ${dismissalNotice}`)) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/integrations/agentic/thesis-extractions?id=${encodeURIComponent(extraction.id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Dismissal failed (${response.status})`);
      }
      if (selectedId === extraction.id) {
        setSelectedId(null);
        setCriteriaDraft(null);
      }
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function excludeVersion(thesis: ThesisVersionRow) {
    const confirmed = window.confirm(
      `Exclude thesis version ${thesis.versionNumber}? It and its linked extraction data will disappear from active views. ` +
      'Historical audit references will remain. If this is the active version, the latest remaining confirmed version will become active.'
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/thesis?id=${encodeURIComponent(thesis.id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Thesis exclusion failed (${response.status})`);
      }
      setSelectedId(null);
      setCriteriaDraft(null);
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
      {transitionNotice && <p className="caveat" role="status">{transitionNotice}</p>}

      <section className="card">
        <h2>1. Submit source document</h2>
        <p className="note">PDF up to 10 MB, or UTF-8 plain text/Markdown up to 2 MB. Active PDF content is rejected. Extraction never becomes canonical automatically.</p>
        <label className="action-button" style={{ display: 'inline-block', cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Working…' : 'Choose thesis document'}
          <input
            type="file"
            accept="application/pdf,text/plain,text/markdown,.pdf,.md,.txt"
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
                    <div className="thesis-extraction-actions">
                      {extraction.status === 'completed' && !extraction.confirmedAt && (
                        <button className="action-button" type="button" onClick={() => review(extraction)}>Review</button>
                      )}
                      {extraction.status === 'failed' && (
                        <button className="action-button" type="button" onClick={() => void retry(extraction)} disabled={busy}>Retry</button>
                      )}
                      {extraction.confirmedAt && <span className="note">Confirmed</span>}
                      <button
                        className="action-button dismiss-button"
                        type="button"
                        onClick={() => void dismiss(extraction)}
                        disabled={busy || !canDismissThesisExtraction(extraction.status)}
                        title="Hide this record from the review queue"
                        aria-label={`Dismiss ${extraction.sourceFileName} from the review queue`}
                      >
                        Dismiss
                      </button>
                    </div>
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
          <p className="note">Extraction confidence: {(selected.resultJson.extractionConfidence * 100).toFixed(0)}%. Review the source-derived mandate below, then confirm. Market research starts only after this human gate.</p>
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
          {criteriaDraft && <ThesisSummary criteria={criteriaDraft} editable onCurrencyChange={(index, currency) => {
            setCriteriaDraft((current) => current && {
              ...current,
              portfolios: current.portfolios.map((portfolio, portfolioIndex) => portfolioIndex === index ? { ...portfolio, currency } : portfolio),
            });
          }} />}
          <p className="note">“Unspecified” means the source document imposed no currency restriction. Discovery then uses the selected portfolio&apos;s native currency (CHF for Swiss Quality; BRL for Brazilian Growth).</p>
          <button className="action-button" type="button" onClick={() => void confirm()} disabled={busy || !criteriaDraft}>
            Confirm thesis version {selected.requestedVersion} &amp; start market research
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
              <button
                className="action-button dismiss-button"
                type="button"
                onClick={() => void excludeVersion(thesis)}
                disabled={busy}
                aria-label={`Exclude thesis version ${thesis.versionNumber}`}
              >
                Exclude version
              </button>
              <ThesisSummary criteria={thesis.criteriaJson as ThesisCriteria} />
            </article>
          ))}</div>
        )}
      </section>
    </main>
  );
}

function roleLabel(role: string): string {
  return role === 'swiss_quality' ? 'Swiss quality' : role === 'brazilian_growth' ? 'Brazilian growth' : role.replaceAll('_', ' ');
}

function ThesisSummary({
  criteria,
  editable = false,
  onCurrencyChange,
}: {
  criteria: ThesisCriteria;
  editable?: boolean;
  onCurrencyChange?: (index: number, value: string) => void;
}) {
  return (
    <div className="thesis-summary" aria-label="Thesis criteria summary">
      {criteria.portfolios.map((portfolio, index) => (
        <article className="thesis-mandate" key={`${portfolio.role}-${index}`}>
          <div className="thesis-mandate-heading">
            <h3>{roleLabel(portfolio.role)}</h3>
            {editable ? (
              <label className="thesis-currency-field">Source currency
                <input
                  value={portfolio.currency}
                  onChange={(event) => onCurrencyChange?.(index, event.target.value)}
                  aria-label={`${roleLabel(portfolio.role)} source currency`}
                  placeholder="Unspecified or CHF"
                />
              </label>
            ) : <span className="badge watch">Source currency: {normalizeThesisMandateCurrency(portfolio.currency) === 'Unspecified' ? 'Not specified' : normalizeThesisMandateCurrency(portfolio.currency)}</span>}
          </div>
          <p><strong>Objective</strong><br />{portfolio.objective}</p>
          <div className="thesis-summary-columns">
            <div><strong>What qualifies</strong>{portfolio.inclusionCriteria.length ? <ul>{portfolio.inclusionCriteria.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="note">No specific inclusion criteria extracted.</p>}</div>
            <div><strong>What disqualifies</strong>{portfolio.exclusionCriteria.length ? <ul>{portfolio.exclusionCriteria.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="note">No specific exclusion criteria extracted.</p>}</div>
          </div>
          {portfolio.targetMetrics && Object.keys(portfolio.targetMetrics).length > 0 && (
            <p className="note"><strong>Target metrics:</strong> {Object.entries(portfolio.targetMetrics).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p>
          )}
        </article>
      ))}
      {criteria.globalConstraints.length > 0 && <div className="thesis-global-constraints"><strong>Portfolio-wide constraints</strong><ul>{criteria.globalConstraints.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    </div>
  );
}
