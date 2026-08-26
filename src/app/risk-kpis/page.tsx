import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { portfolios, riskMetrics } from '@/lib/db/schema';
import { requirePageSession } from '@/lib/page-auth';

export const dynamic = 'force-dynamic';

export default async function RiskKpisPage() {
  const session = await requirePageSession();
  const rows = await db
    .select({
      id: riskMetrics.id,
      portfolio: portfolios.name,
      currency: riskMetrics.currency,
      metric: riskMetrics.metricName,
      value: riskMetrics.value,
      methodology: riskMetrics.methodology,
      confidence: riskMetrics.confidenceLevel,
      horizon: riskMetrics.horizonDays,
      lookback: riskMetrics.lookbackDays,
      annualization: riskMetrics.annualizationFactor,
      caveat: riskMetrics.caveat,
      computedAt: riskMetrics.computedAt,
      dataAsOf: riskMetrics.dataAsOf,
    })
    .from(riskMetrics)
    .innerJoin(portfolios, eq(riskMetrics.portfolioId, portfolios.id))
    .where(eq(portfolios.ownerId, session.userId))
    .orderBy(desc(riskMetrics.computedAt));

  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const key = `${row.portfolio}:${row.metric}`;
    if (!latest.has(key)) latest.set(key, row);
  }

  return (
    <main>
      <h1>Risk & KPIs</h1>
      <p className="sub">Every KPI is deterministic, portfolio-scoped and accompanied by methodology metadata.</p>
      <div className="grid">
        {[...latest.values()].map((r) => (
          <article className="card" key={r.id}>
            <h2>{r.portfolio} · {r.metric}</h2>
            <div className="big">{r.value.toFixed(4)}<span className="cur">{r.currency}</span></div>
            <p className="note">{r.methodology}</p>
            <p className="note">Lookback: {r.lookback ?? '—'} · Horizon: {r.horizon ?? '—'} · Annualization: {r.annualization ?? '—'}</p>
            {r.confidence != null && <p className="note">Confidence: {(r.confidence * 100).toFixed(0)}%</p>}
            {r.caveat && <p className="caveat">{r.caveat}</p>}
            <p className="note">Calculated: {r.computedAt.toISOString()} · Data as of: {r.dataAsOf?.toISOString() ?? '—'}</p>
          </article>
        ))}
      </div>
      {latest.size === 0 && <div className="card"><p className="note">No KPIs computed yet.</p></div>}
    </main>
  );
}
