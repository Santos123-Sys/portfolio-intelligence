/**
 * Overview — functional baseline, intentionally plain.
 *
 * This exists so the app runs end to end and so v0 has a working data contract
 * to redesign against. It is not the finished UI; see V0-DASHBOARD-BRIEF.md.
 *
 * Note what it does NOT do: it renders `totalValueNative` per portfolio and
 * never sums across currencies. The converted grand total comes from the API's
 * separate `displayTotal` key, with its disclaimer rendered alongside.
 */
import { db } from '@/lib/db';
import { portfolios, positions, riskMetrics } from '@/lib/db/schema';
import { eq, sum, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

async function getData() {
  const pfs = await db
    .select({
      id: portfolios.id,
      name: portfolios.name,
      baseCurrency: portfolios.baseCurrency,
      portfolioType: portfolios.portfolioType,
      total: sum(positions.marketValueNative),
    })
    .from(portfolios)
    .leftJoin(positions, eq(positions.portfolioId, portfolios.id))
    .groupBy(portfolios.id);

  const withRisk = await Promise.all(
    pfs.map(async (p) => {
      const rows = await db
        .select()
        .from(riskMetrics)
        .where(eq(riskMetrics.portfolioId, p.id))
        .orderBy(desc(riskMetrics.computedAt))
        .limit(20);
      const latest = new Map<string, typeof rows[number]>();
      for (const r of rows) if (!latest.has(r.metricName)) latest.set(r.metricName, r);
      return { ...p, total: Number(p.total ?? 0), metrics: [...latest.values()] };
    })
  );
  return withRisk;
}

export default async function OverviewPage() {
  let data: Awaited<ReturnType<typeof getData>> = [];
  let error: string | null = null;
  try {
    data = await getData();
  } catch (e) {
    error = (e as Error).message;
  }

  if (error) {
    return (
      <main>
        <h1>Portfolio Intelligence</h1>
        <p className="sub">Overview</p>
        <div className="card">
          <h2>Not connected</h2>
          <p className="note">{error}</p>
          <p className="note">
            Set DATABASE_URL, run <code>npm run db:push</code>, then <code>npm run seed</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>Portfolio Intelligence</h1>
      <p className="sub">
        Every figure below is in its portfolio&apos;s native currency. Nothing on this
        page blends currencies.
      </p>

      {data.length === 0 && (
        <div className="card">
          <h2>No portfolios</h2>
          <p className="note">Run <code>npm run seed</code> to load demo data.</p>
        </div>
      )}

      <div className="grid">
        {data.map((p) => (
          <div key={p.id} className="card">
            <h2>{p.name}</h2>
            <div className="big">
              {p.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              <span className="cur">{p.baseCurrency}</span>
            </div>
            {p.metrics.length === 0 ? (
              <p className="note">No metrics computed yet. Trigger /api/cron/refresh.</p>
            ) : (
              <table style={{ marginTop: '1rem' }}>
                <tbody>
                  {p.metrics.map((m) => (
                    <tr key={m.id}>
                      <td>{m.metricName}</td>
                      <td className="num">
                        {m.metricName.startsWith('VaR') ||
                        m.metricName === 'MaxDrawdown' ||
                        m.metricName === 'Volatility' ||
                        m.metricName === 'TWR'
                          ? `${(m.value * 100).toFixed(2)}%`
                          : m.value.toFixed(3)}
                        <span className="cur">{m.currency}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {p.metrics.some((m) => m.caveat) && (
              <p className="caveat">
                {p.metrics.filter((m) => m.caveat).length} metric(s) carry caveats — see
                the risk detail page.
              </p>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
