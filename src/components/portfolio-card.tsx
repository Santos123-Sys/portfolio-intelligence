'use client';

/** PortfolioCard — Overview page (Page 1). Name, native-currency total,
 * currency label, and the three headline metrics, each drillable. */
import { MetricDrill, type DrillableMetric } from './metric-drill';

export interface PortfolioCardData {
  id: string;
  name: string;
  baseCurrency: string;
  totalValueNative: number;
  metrics: DrillableMetric[];
  metricsLoading: boolean;
}

const HEADLINE_METRICS = ['Volatility', 'Sharpe', 'MaxDrawdown'];

export function PortfolioCard({ data }: { data: PortfolioCardData }) {
  const headline = HEADLINE_METRICS.map(
    (name) => data.metrics.find((m) => m.metricName === name) ?? null
  );

  return (
    <div className="card">
      <h2>{data.name}</h2>
      <div className="big">
        {data.totalValueNative.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        <span className="cur">{data.baseCurrency}</span>
      </div>
      {data.metricsLoading ? (
        <p className="note">Fetching...</p>
      ) : headline.every((m) => m === null) ? (
        <p className="note">No metrics computed yet. Trigger /api/cron/refresh.</p>
      ) : (
        <div className="metric-stack">
          {headline.map((m, i) =>
            m ? (
              <MetricDrill key={m.metricName} metric={m} />
            ) : (
              <div className="metric-drill" key={HEADLINE_METRICS[i]}>
                <span className="metric-name">{HEADLINE_METRICS[i]}</span>
                <span className="num note">not computed</span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
