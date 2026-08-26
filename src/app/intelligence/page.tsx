'use client';

/**
 * AI Intelligence Feed (Page 5) — Section 5.3. Stream of the latest analyses,
 * newest first, classified as new / changed / violated:
 *   - violated: thesisBreakers is non-empty (ADR-004's grounding trail names
 *     the metrics; a breaker is a stated condition, not a computed one).
 *   - changed: supersedesId points at a prior analysis this run replaced.
 *   - new: neither of the above.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

interface AnalysisRow {
  id: string;
  ticker: string;
  companyName: string;
  portfolioRole: string;
  investmentScore: number;
  thesisAlignmentScore: number;
  fundamentalSummary: string | null;
  thesisBreakers: string[] | null;
  supersedesId: string | null;
  analysisTimestamp: string;
}

type FeedFilter = 'all' | 'new' | 'changed' | 'violated';

function classify(row: AnalysisRow, byId: Map<string, AnalysisRow>): FeedFilter {
  if (row.thesisBreakers && row.thesisBreakers.length > 0) return 'violated';
  if (row.supersedesId && byId.has(row.supersedesId)) return 'changed';
  return 'new';
}

export default function IntelligenceFeedPage() {
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FeedFilter>('all');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/analysis')
      .then((res) => {
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        return res.json();
      })
      .then((data: { analyses: AnalysisRow[] }) => {
        if (!cancelled) setRows(data.analyses);
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

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const classified = useMemo(
    () => rows.map((r) => ({ row: r, kind: classify(r, byId) })),
    [rows, byId]
  );
  const visible = filter === 'all' ? classified : classified.filter((c) => c.kind === filter);

  if (error) {
    return (
      <main>
        <h1>AI Intelligence Feed</h1>
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
      <h1>AI Intelligence Feed</h1>
      <p className="sub">New candidates, changed recommendations and thesis violations — newest first.</p>

      <div className="filter-bar">
        {(['all', 'new', 'changed', 'violated'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`portfolio-tab${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="note">Fetching...</p>
      ) : visible.length === 0 ? (
        <div className="card">
          <p className="note">No analyses match this filter yet.</p>
        </div>
      ) : (
        <div className="grid">
          {visible.map(({ row, kind }) => {
            const prior = row.supersedesId ? byId.get(row.supersedesId) : null;
            return (
              <article key={row.id} className={`card feed-item ${kind}`}>
                <h2>
                  {row.companyName} <span className="cur">{row.ticker}</span>
                  <span className={`badge ${kind === 'violated' ? 'breach' : kind === 'changed' ? 'watch' : 'ok'}`} style={{ marginLeft: '0.5rem' }}>
                    {kind.toUpperCase()}
                  </span>
                </h2>

                {kind === 'changed' && prior ? (
                  <div className="feed-diff">
                    <span>Before: {prior.investmentScore}</span>
                    <span className="arrow">→</span>
                    <span>After: {row.investmentScore}</span>
                  </div>
                ) : (
                  <p className="note">Score {row.investmentScore}/100 · Thesis alignment {row.thesisAlignmentScore}/100</p>
                )}

                {kind === 'violated' && (
                  <p className="caveat">Breakers: {(row.thesisBreakers ?? []).join(' · ')}</p>
                )}

                <p>{row.fundamentalSummary}</p>
                <p className="note">{new Date(row.analysisTimestamp).toLocaleString()}</p>
                <Link href={`/security/${row.ticker}`} className="nav-link" style={{ padding: 0, color: 'var(--accent)' }}>
                  {kind === 'violated' ? 'Review position →' : 'View full analysis →'}
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
