'use client';

/**
 * Overview (Page 1) — Section 5.3.
 *
 * Client-only per Section 5.2: no Server Components, no server-side db
 * access from a page. Everything here comes from fetch() in useEffect against
 * the same JSON API a curl request would hit. This page renders responses;
 * it recomputes nothing.
 */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PortfolioCard, type PortfolioCardData } from '@/components/portfolio-card';
import { DisplayTotal, type DisplayTotalData } from '@/components/display-total';
import type { DrillableMetric } from '@/components/metric-drill';

interface PortfolioApiRow {
  id: string;
  name: string;
  baseCurrency: string;
  totalValueNative: number;
}

function OverviewContent() {
  const searchParams = useSearchParams();
  const displayCurrency = searchParams.get('displayCurrency');

  const [cards, setCards] = useState<PortfolioCardData[]>([]);
  const [displayTotal, setDisplayTotalState] = useState<DisplayTotalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const qs = displayCurrency ? `?displayCurrency=${encodeURIComponent(displayCurrency)}` : '';
        const res = await fetch(`/api/portfolios${qs}`);
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data: { portfolios: PortfolioApiRow[]; displayTotal: DisplayTotalData | null } =
          await res.json();

        if (cancelled) return;
        setDisplayTotalState(data.displayTotal);
        setCards(
          data.portfolios.map((p) => ({
            id: p.id,
            name: p.name,
            baseCurrency: p.baseCurrency,
            totalValueNative: p.totalValueNative,
            metrics: [],
            metricsLoading: true,
          }))
        );

        // Risk metrics fetched per-portfolio, in parallel, after the shell renders —
        // the totals shouldn't wait on the slower per-portfolio query.
        await Promise.all(
          data.portfolios.map(async (p) => {
            try {
              const riskRes = await fetch(`/api/risk?portfolioId=${p.id}`);
              if (!riskRes.ok) throw new Error(`risk API returned ${riskRes.status}`);
              const riskData: { metrics: DrillableMetric[] } = await riskRes.json();
              if (cancelled) return;
              setCards((prev) =>
                prev.map((c) => (c.id === p.id ? { ...c, metrics: riskData.metrics, metricsLoading: false } : c))
              );
            } catch {
              if (cancelled) return;
              setCards((prev) => (prev.map((c) => (c.id === p.id ? { ...c, metricsLoading: false } : c))));
            }
          })
        );
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [displayCurrency]);

  if (error) {
    return (
      <main>
        <h1>Portfolio Intelligence</h1>
        <p className="sub">Overview</p>
        <div className="card">
          <h2>Connection error</h2>
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
      <h1>Portfolio Intelligence</h1>
      <p className="sub">
        Every figure below is in its portfolio&apos;s native currency. Nothing on this page blends currencies.
      </p>

      {loading && cards.length === 0 && (
        <div className="card">
          <p className="note">Fetching...</p>
        </div>
      )}

      {!loading && cards.length === 0 && (
        <div className="card">
          <h2>No portfolios configured</h2>
          <p className="note">Create your first portfolio and add at least one holding before running analysis.</p>
          <Link className="action-button inline-action" href="/portfolio-setup">Set up portfolio</Link>
        </div>
      )}

      <div className="grid">
        {cards.map((c) => (
          <PortfolioCard key={c.id} data={c} />
        ))}
      </div>

      <DisplayTotal data={displayTotal} />
    </main>
  );
}

export default function OverviewPage() {
  return (
    <Suspense fallback={<main><p className="sub">Fetching...</p></main>}>
      <OverviewContent />
    </Suspense>
  );
}
