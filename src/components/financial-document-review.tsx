'use client';

import { useEffect, useState } from 'react';

type Fact = { metric: string; normalized_value: number; currency: string; fiscal_period_end: string; page: number; quote: string };
type Draft = { id: string; fileName: string; status: string; createdAt: string;
  extractionJson: { issuer_name: string; gaps: string[] };
  analysisJson: { accepted_facts: Fact[]; rejected_facts: Array<{ metric: string; reason: string }>;
    periods: Array<{ period_end: string; operating_margin: number | null; net_margin: number | null; revenue_growth: number | null }>;
    gaps: string[] } };

export function FinancialDocumentReview({ candidateId, onApproved }: { candidateId: string; onApproved: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/discovery/financial-documents?candidateId=${encodeURIComponent(candidateId)}`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setDrafts(body.drafts ?? []); })
      .catch((error) => { if (!controller.signal.aborted) setMessage((error as Error).message); });
    return () => controller.abort();
  }, [candidateId, reload]);
  const pending = drafts.find((draft) => draft.status === 'awaiting_review');
  const facts = pending?.analysisJson.accepted_facts ?? [];
  async function upload() {
    if (!file) return;
    setBusy(true); setMessage(null);
    try {
      if (file.size > 5_000_000 || file.type !== 'application/pdf') throw new Error('Choose a PDF no larger than 5 MB.');
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read PDF'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.readAsDataURL(file);
      });
      const response = await fetch('/api/discovery/financial-documents', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId, fileName: file.name, contentBase64 }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Extraction failed');
      setMessage('Extraction is ready for review. Verify the PDF pages and select only facts you accept.');
      setFile(null); setSelected([]); setReload((value) => value + 1);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function approve() {
    if (!pending || !selected.length) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/discovery/financial-documents/${pending.id}/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selectedIndices: selected }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Approval failed');
      setMessage(`${body.approvedFacts} selected facts entered the financial report.`);
      setSelected([]); setReload((value) => value + 1); onApproved();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="financial-document-review">
    <h4>Swiss annual report PDF</h4>
    <p className="note">Upload the issuer’s annual PDF. AI extracts proposed facts; Python calculates draft ratios. Review each fact against its cited page before importing it. Extraction alone never unlocks valuation.</p>
    <label>Annual report PDF <input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
    <button className="secondary-button" type="button" disabled={busy || !file} onClick={() => void upload()}>{busy ? 'Processing…' : 'Extract PDF for review'}</button>
    {message && <p className="note" role="status">{message}</p>}
    {pending && <div><p><strong>Review draft:</strong> {pending.fileName} · issuer {pending.extractionJson.issuer_name} · <a href={`/api/discovery/financial-documents/${pending.id}/pdf`} target="_blank" rel="noopener noreferrer">Open original PDF</a></p>
      <p className="note">Choose the facts you verified. Values are shown in the filing currency after the reported unit multiplier.</p>
      <div className="table-scroll"><table><thead><tr><th>Accept</th><th>Metric</th><th>Year end</th><th>Value</th><th>Page</th><th>Evidence</th></tr></thead>
        <tbody>{facts.map((fact, index) => <tr key={`${fact.metric}-${fact.fiscal_period_end}-${index}`}>
          <td><input type="checkbox" aria-label={`Accept ${fact.metric} on page ${fact.page}`} checked={selected.includes(index)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, index] : current.filter((item) => item !== index))} /></td>
          <td>{fact.metric}</td><td>{fact.fiscal_period_end}</td><td>{fact.currency} {fact.normalized_value.toLocaleString()}</td><td>{fact.page}</td><td>{fact.quote}</td></tr>)}</tbody></table></div>
      {pending.analysisJson.periods.map((period) => <p className="note" key={period.period_end}>{period.period_end}: Python analysis · operating margin {period.operating_margin == null ? 'unavailable' : `${(period.operating_margin * 100).toFixed(1)}%`} · growth {period.revenue_growth == null ? 'unavailable' : `${(period.revenue_growth * 100).toFixed(1)}%`}</p>)}
      {[...pending.extractionJson.gaps, ...pending.analysisJson.gaps].map((gap, index) => <p className="caveat" key={`${index}-${gap}`}>{gap}</p>)}
      <button className="action-button" type="button" disabled={busy || !selected.length} onClick={() => void approve()}>Approve selected facts</button>
    </div>}
  </section>;
}
