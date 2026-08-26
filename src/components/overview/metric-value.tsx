'use client';

/**
 * A clickable metric value. Per the design brief, no number on this dashboard
 * is permitted to stand alone — every one reveals its methodology on demand.
 */

import { useState } from 'react';
import { formatMetricValue, METRIC_LABELS, type HeadlineMetric } from './format';

export function MetricValue({ metric }: { metric: HeadlineMetric }) {
  const [open, setOpen] = useState(false);
  const detailId = `metric-detail-${metric.metricName}`;

  return (
    <div className="metric">
      <button
        type="button"
        className="metric-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={detailId}
      >
        <span className="metric-label">{METRIC_LABELS[metric.metricName] ?? metric.metricName}</span>
        <span className="metric-value-row">
          <span className="metric-value">{formatMetricValue(metric)}</span>
          <span className="cur">{metric.currency}</span>
          <span className="metric-chevron" aria-hidden="true">
            {open ? '−' : '+'}
          </span>
        </span>
      </button>

      {open && (
        <dl id={detailId} className="metric-detail">
          <dt>Methodology</dt>
          <dd>{metric.methodology}</dd>

          {metric.confidenceLevel !== null && (
            <>
              <dt>Confidence level</dt>
              <dd>{(metric.confidenceLevel * 100).toFixed(0)}%</dd>
            </>
          )}

          {metric.horizonDays !== null && (
            <>
              <dt>Horizon</dt>
              <dd>
                {metric.horizonDays} trading day{metric.horizonDays === 1 ? '' : 's'}
              </dd>
            </>
          )}

          {metric.lookbackDays !== null && (
            <>
              <dt>Lookback</dt>
              <dd>{metric.lookbackDays} trading days</dd>
            </>
          )}

          <dt>Computed</dt>
          <dd>{new Date(metric.computedAt).toLocaleString()}</dd>

          {metric.caveat && (
            <>
              <dt className="caveat-label">Caveat</dt>
              <dd className="caveat">{metric.caveat}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
