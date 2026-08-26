'use client';

/**
 * MetricDrill — Section 3.2 "Drill-down on click" and ADR-003 ("every metric
 * carries methodology"). Renders value + currency by default; clicking (or
 * the "[click for methodology]" affordance) expands methodology, confidence,
 * horizon, lookback, annualization and caveat.
 *
 * This component never recalculates anything — it only renders fields already
 * present on the metric object returned by /api/risk. That is the whole point
 * of the read-only visualization layer (Section 2.1, Layer 3).
 */
import { useState } from 'react';

export interface DrillableMetric {
  metricName: string;
  value: number;
  currency: string;
  methodology?: string | null;
  confidenceLevel?: number | null;
  horizonDays?: number | null;
  lookbackDays?: number | null;
  annualizationFactor?: number | null;
  caveat?: string | null;
  computedAt?: string | null;
  dataAsOf?: string | null;
}

const PERCENT_METRICS = new Set(['Volatility', 'MaxDrawdown', 'TWR', 'VaR', 'VaR_Historical', 'VaR_Parametric']);

function formatValue(m: DrillableMetric): string {
  const isPercent = [...PERCENT_METRICS].some((p) => m.metricName.startsWith(p));
  return isPercent ? `${(m.value * 100).toFixed(2)}%` : m.value.toFixed(3);
}

export function MetricDrill({ metric, isLoading = false }: { metric: DrillableMetric; isLoading?: boolean }) {
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="metric-drill">
        <span className="metric-name">{metric.metricName}</span>
        <span className="num">Fetching...</span>
      </div>
    );
  }

  return (
    <div className="metric-drill">
      <button
        type="button"
        className="metric-drill-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="metric-name">{metric.metricName}</span>
        <span className="num">
          {formatValue(metric)}
          <span className="cur">{metric.currency}</span>
        </span>
      </button>
      {!open && <span className="note metric-drill-hint">[click for methodology]</span>}
      {open && (
        <div className="metric-drill-detail">
          <p className="note">{metric.methodology ?? 'No methodology recorded.'}</p>
          <p className="note">
            Confidence: {metric.confidenceLevel != null ? `${(metric.confidenceLevel * 100).toFixed(0)}%` : '—'} ·
            {' '}Horizon: {metric.horizonDays ?? '—'}d · Lookback: {metric.lookbackDays ?? '—'}d ·
            {' '}Annualization: {metric.annualizationFactor ?? '—'}
          </p>
          <p className="note">
            Computed: {metric.computedAt ? new Date(metric.computedAt).toLocaleString() : '—'} · Data as of:{' '}
            {metric.dataAsOf ? new Date(metric.dataAsOf).toLocaleString() : '—'}
          </p>
          {metric.caveat && <p className="caveat">{metric.caveat}</p>}
        </div>
      )}
    </div>
  );
}
