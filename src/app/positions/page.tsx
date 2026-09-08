'use client';

/**
 * Positions (Page 3) — Section 5.3. Sortable, filterable position table
 * across all portfolios (filterable down to one). Row click navigates to the
 * Security Detail page.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface PositionRow {
  id: string;
  portfolioId: string;
  portfolioName: string;
  ticker: string;
  companyName: string;
  currency: string;
  sector: string | null;
  country: string | null;
  quantity: string | number;
  avgCost: string | number;
  marketValueNative: string | number | null;
  weight: number | null;
  dayChangePct: number | null;
  aiScore: number | null;
  thesisAlignment: number | null;
  riskScore: number | null;
  thesisBreakers: string[] | null;
}

interface ResearchCandidateRow {
  id: string;
  ticker: string;
  companyName: string;
  country: string | null;
  sector: string | null;
  portfolioName: string;
  decision: string;
  workflowStatus: string;
  thesisAlignmentScore: number | null;
  latestPrice: {
    close: number;
    currency: string;
    asOf: string;
    provider: string;
    sourceUrl: string | null;
  } | null;
}

function formatLatestResearchPrice(price: ResearchCandidateRow['latestPrice']): string | null {
  if (!price) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency, maximumFractionDigits: 2 }).format(price.close);
  } catch {
    return `${price.currency} ${price.close.toFixed(2)}`;
  }
}

interface LatestResearch {
  latestRun: { requestedAt: string; completedAt: string | null; provider: string } | null;
  candidates: ResearchCandidateRow[];
}

type SortKey = 'ticker' | 'portfolioName' | 'quantity' | 'avgCost' | 'marketValueNative' | 'weight' | 'dayChangePct' | 'aiScore' | 'thesisAlignment';

function riskFlag(row: PositionRow): { label: string; className: string } {
  if (row.thesisBreakers && row.thesisBreakers.length > 0) return { label: 'BREACH', className: 'breach' };
  if (row.riskScore != null && row.riskScore >= 70) return { label: 'WATCH', className: 'watch' };
  return { label: 'OK', className: 'ok' };
}

export default function PositionsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [research, setResearch] = useState<LatestResearch>({ latestRun: null, candidates: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [portfolioFilter, setPortfolioFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('weight');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/positions').then((res) => {
        if (!res.ok) throw new Error(`Positions API returned ${res.status}`);
        return res.json() as Promise<{ positions: PositionRow[] }>;
      }),
      fetch('/api/portfolio/research').then((res) => {
        if (!res.ok) throw new Error(`Research API returned ${res.status}`);
        return res.json() as Promise<LatestResearch>;
      }),
    ])
      .then(([positionsData, researchData]) => {
        if (cancelled) return;
        setRows(positionsData.positions);
        setResearch(researchData);
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

  const sectors = useMemo(() => [...new Set(rows.map((r) => r.sector).filter(Boolean))] as string[], [rows]);
  const countries = useMemo(() => [...new Set(rows.map((r) => r.country).filter(Boolean))] as string[], [rows]);
  const portfolioNames = useMemo(() => [...new Set(rows.map((r) => r.portfolioName))], [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (sectorFilter && r.sector !== sectorFilter) return false;
      if (countryFilter && r.country !== countryFilter) return false;
      if (portfolioFilter && r.portfolioName !== portfolioFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.ticker.toLowerCase().includes(q) && !r.companyName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, sectorFilter, countryFilter, portfolioFilter, search]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = av == null ? -Infinity : Number(av);
      const bn = bv == null ? -Infinity : Number(bv);
      if (typeof av === 'string' || typeof bv === 'string') {
        return dir * String(av ?? '').localeCompare(String(bv ?? ''));
      }
      return dir * (an - bn);
    });
  }, [filtered, sortKey, sortDir]);

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function resetFilters() {
    setSearch('');
    setSectorFilter('');
    setCountryFilter('');
    setPortfolioFilter('');
  }

  function headerProps(key: SortKey) {
    return {
      className: `num sortable${sortKey === key ? ' active' : ''}`,
      onClick: () => sortBy(key),
      title: 'Click to sort',
    };
  }

  function researchState(candidate: ResearchCandidateRow) {
    if (candidate.workflowStatus === 'analysis_complete') return 'Research complete';
    if (candidate.workflowStatus === 'analysis_failed') return 'Research needs attention';
    if (candidate.decision === 'approved') return 'Approved for analysis';
    if (candidate.decision === 'watchlist') return 'Watchlist';
    if (candidate.decision === 'rejected') return 'Rejected';
    return 'Awaiting review';
  }

  if (error) {
    return (
      <main>
        <h1>Positions</h1>
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
      <h1>Positions</h1>
      <p className="sub">Every row is a single portfolio&apos;s holding. Values stay in that portfolio&apos;s native currency.</p>

      <div className="filter-bar">
        <input
          type="search"
          placeholder="Search ticker or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={portfolioFilter} onChange={(e) => setPortfolioFilter(e.target.value)}>
          <option value="">All portfolios</option>
          {portfolioNames.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)}>
          <option value="">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <section className="research-pipeline card" aria-label="Latest market research">
        <div className="research-pipeline-heading">
          <div>
            <p className="analysis-eyebrow">Market research</p>
            <h2>Latest research candidates</h2>
            <p className="note">Candidates are opportunities for review, not portfolio holdings. A position appears below only after you record an investment decision and quantity.</p>
          </div>
          <Link className="action-button inline-action" href="/ai-stock-discovery">Review candidates</Link>
        </div>
        {!research.latestRun ? (
          <p className="note">No completed market-research run yet. Start discovery to populate this review queue.</p>
        ) : research.candidates.length === 0 ? (
          <p className="note">No active candidates remain from the latest market-research run. Rejected ideas are kept in Research history and are not shown here.</p>
        ) : (
          <>
            <p className="note">{research.candidates.length} candidate{research.candidates.length === 1 ? '' : 's'} found on {new Date(research.latestRun.completedAt ?? research.latestRun.requestedAt).toLocaleDateString()} via {research.latestRun.provider}.</p>
            <div className="research-candidate-grid">
              {research.candidates.map((candidate) => <div className="research-candidate" key={candidate.id}>
                <div><strong>{candidate.companyName}</strong><span>{candidate.ticker} · {candidate.portfolioName}</span></div>
                <span className={`badge ${candidate.decision === 'rejected' || candidate.workflowStatus === 'analysis_failed' ? 'breach' : candidate.decision === 'approved' || candidate.workflowStatus === 'analysis_complete' ? 'ok' : 'watch'}`}>{researchState(candidate)}</span>
                          <p>{candidate.sector ?? 'Sector not classified'} · {candidate.country ?? 'Country not classified'}{candidate.thesisAlignmentScore == null ? '' : ` · ${candidate.thesisAlignmentScore}/100 thesis fit`}</p>
                          {candidate.latestPrice && <p className="note">Latest market close: {formatLatestResearchPrice(candidate.latestPrice)} · {candidate.latestPrice.asOf}</p>}
              </div>)}
            </div>
          </>
        )}
      </section>

      {loading ? (
        <p className="note">Fetching...</p>
      ) : sorted.length === 0 ? (
        <div className="card">
          {rows.length === 0 ? (
            <>
              <p className="note">No positions have been recorded. Approving a research candidate does not add a holding automatically.</p>
              <Link className="action-button inline-action" href="/portfolio-setup#add-position">Add a position</Link>
            </>
          ) : (
            <>
              <p className="note">No positions match the current filters.</p>
              <button className="action-button" type="button" onClick={resetFilters}>Reset filters</button>
            </>
          )}
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="sortable" onClick={() => sortBy('ticker')}>Ticker</th>
                <th>Name</th>
                <th className="sortable" onClick={() => sortBy('portfolioName')}>Portfolio</th>
                <th {...headerProps('quantity')}>Qty</th>
                <th {...headerProps('avgCost')}>Avg Cost</th>
                <th {...headerProps('marketValueNative')}>Market Value</th>
                <th {...headerProps('weight')}>Weight</th>
                <th {...headerProps('dayChangePct')}>Day Δ</th>
                <th {...headerProps('aiScore')}>AI Score</th>
                <th {...headerProps('thesisAlignment')}>Thesis Align</th>
                <th className="num">Risk Flag</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const flag = riskFlag(r);
                return (
                  <tr key={r.id} onClick={() => router.push(`/security/${r.ticker}`)} style={{ cursor: 'pointer' }}>
                    <td><strong>{r.ticker}</strong></td>
                    <td>{r.companyName}<br /><span className="note">{r.currency}</span></td>
                    <td>{r.portfolioName}</td>
                    <td className="num">{Number(r.quantity).toLocaleString()}</td>
                    <td className="num">{Number(r.avgCost).toFixed(2)}</td>
                    <td className="num">{r.marketValueNative == null ? '—' : Number(r.marketValueNative).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="num">{r.weight == null ? '—' : `${(r.weight * 100).toFixed(2)}%`}</td>
                    <td className="num">{r.dayChangePct == null ? '—' : `${(r.dayChangePct * 100).toFixed(2)}%`}</td>
                    <td className="num">{r.aiScore ?? '—'}</td>
                    <td className="num">{r.thesisAlignment ?? '—'}</td>
                    <td className="num"><span className={`badge ${flag.className}`}>{flag.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
