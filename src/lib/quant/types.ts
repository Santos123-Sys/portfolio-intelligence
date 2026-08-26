/**
 * Core types for the quantitative engine.
 *
 * ARCHITECTURAL RULE (ADR-001): Nothing in this directory may call an LLM.
 * Every function here is deterministic and independently testable.
 *
 * ARCHITECTURAL RULE (ADR-002): Every metric is scoped to exactly one currency.
 * There is no function in this engine that combines figures across currencies.
 * The only cross-currency operation in the entire system is `displayTotal()`,
 * which lives in src/lib/fx and is explicitly display-only.
 */

export type Currency = 'CHF' | 'BRL' | 'USD' | 'EUR';

export type PortfolioType = 'swiss_quality' | 'brazilian_growth' | 'fixed_income';

export type VaRMethod = 'historical' | 'parametric' | 'monte_carlo';

/**
 * A calculated metric together with everything a reviewer needs to judge it.
 *
 * This shape exists because of the explainability requirement: a risk number
 * without its methodology is not auditable. Any UI rendering a `value` must be
 * able to surface the rest of this object on demand.
 */
export interface RiskMetric {
  metricName: string;
  value: number;
  /** Never null. A metric with no currency scope is a bug (ADR-002). */
  currency: Currency;
  methodology: string;
  /** e.g. 0.95 for 95% VaR. Null where not applicable (volatility, Sharpe). */
  confidenceLevel: number | null;
  /** Forward horizon in trading days. Null where not applicable. */
  horizonDays: number | null;
  /** How many observations the calculation consumed. */
  lookbackDays: number | null;
  /** Periods per year used for annualization (252 daily, 12 monthly). */
  annualizationFactor: number | null;
  /** When this was computed. */
  computedAt: string;
  /** Timestamp of the newest input datum. May lag computedAt. */
  dataAsOf: string;
  /**
   * Populated when the result is real but should not be trusted at face value —
   * e.g. too few observations for the requested confidence level.
   */
  caveat: string | null;
}

/** A single dated observation of a portfolio's value, in native currency. */
export interface ValuationPoint {
  date: string; // ISO yyyy-mm-dd
  value: number;
}

/** An external cash movement into (+) or out of (-) the portfolio. */
export interface CashFlow {
  date: string; // ISO yyyy-mm-dd
  amount: number;
}

export interface WeightRow {
  key: string;
  label: string;
  value: number;
  weight: number; // 0..1
}

export class QuantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuantError';
  }
}

/** Trading days per year — the annualization convention used throughout. */
export const TRADING_DAYS = 252;

export function isoNow(): string {
  return new Date().toISOString();
}
