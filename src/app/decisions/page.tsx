'use client';

/**
 * Decision Log (Page 7) — Section 5.3. Append-only, searchable reference.
 * There is deliberately no edit or delete affordance anywhere on this page —
 * matching the schema, which no application code ever UPDATEs or DELETEs.
 */
import { useEffect, useMemo, useState } from 'react';

interface DecisionRow {
  id: string;
  decisionDate: string;
  title: string;
  decision: string;
  reasoning: string | null;
  alternativesConsidered: string | null;
  outcome: string | null;
  relatedSecurityTicker: string | null;
  relatedPortfolioName: string | null;
}

export default function DecisionLogPage() {
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const qs = search ? `?q=${encodeURIComponent(search)}` : '';
    setLoading(true);
    fetch(`/api/decision-log${qs}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        return res.json();
      })
      .then((data: { decisions: DecisionRow[] }) => {
        if (!cancelled) setRows(data.decisions);
      })
      .catch((e) => {
        if (!cancelled && (e as Error).name !== 'AbortError') setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [search]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.decisionDate.localeCompare(a.decisionDate)),
    [rows]
  );

  if (error) {
    return (
      <main>
        <h1>Decision Log</h1>
        <div className="card">
          <p className="note">
            Connection failed: Unable to reach backend.
            <br />
            Check that the API is running and DATABASE_URL is set.
            <br />
            {error}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>Decision Log</h1>
      <p className="sub">Append-only. Most recent 50 entries, searchable across title and reasoning.</p>

      <div className="filter-bar">
        <input
          type="search"
          placeholder="Search decisions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: '260px' }}
        />
      </div>

      {loading ? (
        <p className="note">Fetching...</p>
      ) : sorted.length === 0 ? (
        <div className="card">
          <p className="note">
            {search ? 'No decisions match this search.' : 'No decisions logged yet.'}
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Title</th>
                <th>Reasoning</th>
                <th>Related Security</th>
                <th>Related Portfolio</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.id}>
                  <td className="num">{new Date(d.decisionDate).toLocaleDateString()}</td>
                  <td><strong>{d.title}</strong><br /><span className="note">{d.decision}</span></td>
                  <td>{d.reasoning ?? '—'}</td>
                  <td>{d.relatedSecurityTicker ?? '—'}</td>
                  <td>{d.relatedPortfolioName ?? '—'}</td>
                  <td>{d.outcome ?? <span className="note">pending</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
