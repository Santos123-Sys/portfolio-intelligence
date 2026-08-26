'use client';

/**
 * Allocation (Page 2) — Section 5.3. Weight breakdown by sector, country and
 * asset class, for exactly one portfolio at a time (ADR-002: no blending
 * across currencies, and grouping two portfolios together would do exactly
 * that for any portfolio pair in different native currencies).
 */
import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { PortfolioSelector, type SelectablePortfolio } from '@/components/portfolio-selector';
import { usePortfolioBreadcrumb } from '@/lib/portfolio-context';

interface PositionRow {
  id: string;
  ticker: string;
  companyName: string;
  sector: string | null;
  country: string | null;
  portfolioId: string;
  marketValueNative: string | number | null;
  weight: number | null;
}

interface GroupRow {
  key: string;
  label: string;
  value: number;
  weight: number;
}

const COLORS = ['#4a9eff', '#d9a441', '#6fcf97', '#bb86fc', '#e05c5c', '#56b8d1', '#8b949e'];

function groupBy(rows: PositionRow[], keyFn: (r: PositionRow) => string | null): GroupRow[] {
  const totals = new Map<string, number>();
  let grandTotal = 0;
  for (const r of rows) {
    const key = keyFn(r) ?? 'Unclassified';
    const value = Number(r.marketValueNative ?? 0);
    totals.set(key, (totals.get(key) ?? 0) + value);
    grandTotal += value;
  }
  return [...totals.entries()]
    .map(([key, value]) => ({ key, label: key, value, weight: grandTotal > 0 ? value / grandTotal : 0 }))
    .sort((a, b) => b.value - a.value);
}

function DonutSection({ title, groups }: { title: string; groups: GroupRow[] }) {
  return (
    <div className="chart-card">
      <h2>{title}</h2>
      {groups.length === 0 ? (
        <p className="note">No positions to allocate.</p>
      ) : (
        <>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={groups} dataKey="value" nameKey="label" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {groups.map((g, i) => (
                    <Cell key={g.key} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, name: string) => [value.toLocaleString(undefined, { maximumFractionDigits: 0 }), name]}
                  contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', fontSize: '0.8rem' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <table>
            <thead>
              <tr>
                <th>{title}</th>
                <th className="num">Value</th>
                <th className="num">Weight</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td>{g.label}</td>
                  <td className="num">{g.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="num">{(g.weight * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default function AllocationPage() {
  const { setViewing } = usePortfolioBreadcrumb();
  const [portfolios, setPortfolios] = useState<SelectablePortfolio[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/portfolios');
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data: { portfolios: SelectablePortfolio[] } = await res.json();
        if (cancelled) return;
        setPortfolios(data.portfolios);
        if (data.portfolios.length > 0) setSelectedId((cur) => cur ?? data.portfolios[0].id);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    load();
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
    fetch(`/api/positions?portfolioId=${selectedId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        return res.json();
      })
      .then((data: { positions: PositionRow[] }) => {
        if (!cancelled) setPositions(data.positions);
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

  const sectorGroups = useMemo(() => groupBy(positions, (r) => r.sector), [positions]);
  const countryGroups = useMemo(() => groupBy(positions, (r) => r.country), [positions]);
  const selectedPortfolio = portfolios.find((p) => p.id === selectedId) ?? null;
  const assetClassGroups = useMemo(
    () => (selectedPortfolio ? groupBy(positions, () => 'Equity') : []),
    [positions, selectedPortfolio]
  );

  if (error) {
    return (
      <main>
        <h1>Allocation</h1>
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
      <h1>Allocation</h1>
      <p className="sub">Weight breakdown by sector, country and asset class. One portfolio at a time — never blended.</p>

      <PortfolioSelector portfolios={portfolios} selectedId={selectedId} onSelect={setSelectedId} />

      {loading ? (
        <p className="note">Fetching...</p>
      ) : positions.length === 0 ? (
        <div className="card">
          <p className="note">No positions in this portfolio yet.</p>
        </div>
      ) : (
        <div className="grid">
          <DonutSection title="Sector" groups={sectorGroups} />
          <DonutSection title="Country" groups={countryGroups} />
          <DonutSection title="Asset Class" groups={assetClassGroups} />
        </div>
      )}
    </main>
  );
}
