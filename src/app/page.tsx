/**
 * Overview — Phase 1 of the dashboard build (see the v0 implementation guide).
 *
 * Renders `totalValueNative` per portfolio and never sums across currencies.
 * The one sanctioned cross-currency figure, the display total, is fetched
 * lazily client-side from /api/portfolios?displayCurrency=... so a slow or
 * failing ECB lookup can never block the native-currency figures below.
 */

import { DisplayTotalToggle } from '@/components/overview/display-total-toggle';
import { PortfolioCard, type PortfolioCardData } from '@/components/overview/portfolio-card';
import type { HeadlineMetric } from '@/components/overview/format';

export const dynamic = 'force-dynamic';

const HEADLINE_METRIC_NAMES = ['Volatility', 'Sharpe', 'MaxDrawdown'] as const;

async function getData(): Promise<PortfolioCardData[]> {
  // Load the database client only when the page requests data so a missing or
  // temporarily unavailable integration renders a useful connection state.
  const [{ db }, { portfolios, positions, riskMetrics }, { eq, sum, desc }] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('drizzle-orm'),
  ]);

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

  return Promise.all(
    pfs.map(async (p) => {
      const rows = await db
        .select()
        .from(riskMetrics)
        .where(eq(riskMetrics.portfolioId, p.id))
        .orderBy(desc(riskMetrics.computedAt))
        .limit(40);

      const latestByName = new Map<string, (typeof rows)[number]>();
      for (const r of rows) if (!latestByName.has(r.metricName)) latestByName.set(r.metricName, r);

      const headlineMetrics: (HeadlineMetric | null)[] = HEADLINE_METRIC_NAMES.map((name) => {
        const m = latestByName.get(name);
        if (!m) return null;
        return {
          metricName: m.metricName,
          value: m.value,
          currency: m.currency,
          methodology: m.methodology,
          confidenceLevel: m.confidenceLevel,
          horizonDays: m.horizonDays,
          lookbackDays: m.lookbackDays,
          annualizationFactor: m.annualizationFactor,
          caveat: m.caveat,
          computedAt: m.computedAt.toISOString(),
          dataAsOf: m.dataAsOf ? m.dataAsOf.toISOString() : null,
        };
      });

      return {
        id: p.id,
        name: p.name,
        baseCurrency: p.baseCurrency,
        portfolioType: p.portfolioType,
        total: Number(p.total ?? 0),
        headlineMetrics,
        caveatCount: [...latestByName.values()].filter((m) => m.caveat).length,
      };
    })
  );
}

export default async function OverviewPage() {
  let data: PortfolioCardData[] = [];
  let error: string | null = null;
  try {
    data = await getData();
  } catch (e) {
    error = (e as Error).message;
  }

  if (error) {
    return (
      <main>
        <p className="eyebrow">Portfolio Intelligence</p>
        <h1>Overview</h1>
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

  const defaultDisplayCurrency = data[0]?.baseCurrency ?? 'CHF';

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Portfolio Intelligence</p>
          <h1>Overview</h1>
          <p className="sub">
            Every figure below is in its portfolio&apos;s native currency. Nothing on this
            page blends currencies.
          </p>
        </div>
        {data.length > 0 && <DisplayTotalToggle defaultCurrency={defaultDisplayCurrency} />}
      </header>

      {data.length === 0 && (
        <div className="card">
          <h2>No portfolios</h2>
          <p className="note">
            Run <code>npm run seed</code> to load demo data.
          </p>
        </div>
      )}

      <div className="grid">
        {data.map((p) => (
          <PortfolioCard key={p.id} portfolio={p} />
        ))}
      </div>
    </main>
  );
}
