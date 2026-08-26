import { MetricValue } from './metric-value';
import { PORTFOLIO_TYPE_LABELS, type HeadlineMetric } from './format';

const HEADLINE_METRIC_NAMES = ['Volatility', 'Sharpe', 'MaxDrawdown'] as const;

export interface PortfolioCardData {
  id: string;
  name: string;
  baseCurrency: string;
  portfolioType: string;
  total: number;
  headlineMetrics: (HeadlineMetric | null)[];
  caveatCount: number;
}

export function PortfolioCard({ portfolio }: { portfolio: PortfolioCardData }) {
  return (
    <div className="card portfolio-card">
      <div className="portfolio-card-header">
        <h2>{portfolio.name}</h2>
        <span className="badge">
          {PORTFOLIO_TYPE_LABELS[portfolio.portfolioType] ?? portfolio.portfolioType}
        </span>
      </div>

      <div className="big">
        {portfolio.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        <span className="cur">{portfolio.baseCurrency}</span>
      </div>

      <div className="metrics">
        {portfolio.headlineMetrics.map((metric, i) =>
          metric ? (
            <MetricValue key={metric.metricName} metric={metric} />
          ) : (
            <div key={HEADLINE_METRIC_NAMES[i]} className="metric metric-empty">
              <span className="metric-label">{HEADLINE_METRIC_NAMES[i]}</span>
              <span className="note">Not yet computed</span>
            </div>
          )
        )}
      </div>

      {portfolio.caveatCount > 0 && (
        <p className="caveat">
          {portfolio.caveatCount} metric{portfolio.caveatCount === 1 ? '' : 's'} carry caveats
          — expand a metric above for details.
        </p>
      )}
    </div>
  );
}
