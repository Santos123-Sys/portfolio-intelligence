'use client';

/**
 * Risk Detail (Page 6) — Section 5.3. Every persisted metric for one
 * portfolio, each individually drillable into its full methodology
 * (ADR-003), plus the global caveat about VaR/parametric assumptions that
 * must stay visible regardless of which metric is expanded.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PortfolioSelector, type SelectablePortfolio } from '@/components/portfolio-selector';
import { MetricDrill, type DrillableMetric } from '@/components/metric-drill';
import { usePortfolioBreadcrumb } from '@/lib/portfolio-context';

function GlobalCaveat() {
  return (
    <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: '2rem' }}>
      <p className="caveat" style={{ marginTop: 0 }}>
        VaR and parametric measures assume normality and liquidity. A concentrated 10–30 position
        portfolio often violates these assumptions.
      </p>
    </div>
  );
}

export default function RiskDetailPage() {
  const { setViewing } = usePortfolioBreadcrumb();
  const [portfolios, setPortfolios] = useState<SelectablePortfolio[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DrillableMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/portfolios')
      .then((res) => {
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        return res.json();
      })
      .then((data: { portfolios: SelectablePortfolio[] }) => {
        if (cancelled) return;
        setPortfolios(data.portfolios);
        if (data.portfolios.length > 0) setSelectedId((cur) => cur ?? data.portfolios[0].id);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const p = portfolios.find((x) => x.id === selectedId);
    if (p) setViewing({ id: p.id, name: p.name, currency: p.baseCurrency });
  }, [selectedId, portfolios, setViewing]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/risk?portfolioId=${selectedId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        return res.json();
      })
      .then((data: { metrics: DrillableMetric[] }) => {
        if (!cancelled) setMetrics(data.metrics);
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
  }, [selectedId]);

  if (error) {
    return (
      <main>
        <h1>Portfolio risk</h1>
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
      <h1>Portfolio risk</h1>
      <p className="sub">Portfolio-level risk for recorded holdings. Candidate risk is reviewed inside the discovery workflow before a holding is added.</p>

      <GlobalCaveat />

      <PortfolioSelector portfolios={portfolios} selectedId={selectedId} onSelect={setSelectedId} />

      {loading ? (
        <p className="note">Fetching...</p>
      ) : metrics.length === 0 ? (
        <div className="card">
          <h2>Portfolio metrics will appear when they are meaningful</h2>
          <p className="note">This portfolio has no computed holding-level metrics yet. They are refreshed automatically after there are recorded positions and sufficient market-price history. This does not affect candidate-level research risk.</p>
          <Link className="action-button inline-action" href="/positions">Review positions</Link>
        </div>
      ) : (
        <div className="grid">
          {metrics.map((m) => (
            <div className="card" key={m.metricName}>
              <MetricDrill metric={m} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
