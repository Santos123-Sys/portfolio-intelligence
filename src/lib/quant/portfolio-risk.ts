import { QuantError } from './types';
import { mean, stdDev } from './risk';

export function covariance(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new QuantError('covariance: series length mismatch');
  if (a.length < 2) throw new QuantError('covariance: need at least two observations');
  const ma = mean(a);
  const mb = mean(b);
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc += (a[i] - ma) * (b[i] - mb);
  return acc / (a.length - 1);
}

export function beta(assetReturns: number[], benchmarkReturns: number[]): number {
  const variance = covariance(benchmarkReturns, benchmarkReturns);
  if (variance === 0) throw new QuantError('beta: benchmark variance is zero');
  return covariance(assetReturns, benchmarkReturns) / variance;
}

export function covarianceMatrix(series: Record<string, number[]>): Record<string, Record<string, number>> {
  const keys = Object.keys(series);
  const out: Record<string, Record<string, number>> = {};
  for (const a of keys) {
    out[a] = {};
    for (const b of keys) out[a][b] = covariance(series[a], series[b]);
  }
  return out;
}

export function portfolioVariance(weights: Record<string, number>, matrix: Record<string, Record<string, number>>): number {
  const keys = Object.keys(weights);
  let variance = 0;
  for (const i of keys) {
    for (const j of keys) variance += weights[i] * weights[j] * matrix[i][j];
  }
  return variance;
}

export function componentRiskContribution(
  weights: Record<string, number>,
  matrix: Record<string, Record<string, number>>
): Record<string, number> {
  const variance = portfolioVariance(weights, matrix);
  if (variance <= 0) throw new QuantError('componentRiskContribution: non-positive portfolio variance');
  const keys = Object.keys(weights);
  const out: Record<string, number> = {};
  for (const i of keys) {
    let marginal = 0;
    for (const j of keys) marginal += matrix[i][j] * weights[j];
    out[i] = (weights[i] * marginal) / variance;
  }
  return out;
}

export function concentrationHerfindahl(weights: number[]): number {
  if (weights.length === 0) throw new QuantError('concentrationHerfindahl: empty weights');
  return weights.reduce((acc, w) => acc + w * w, 0);
}

export function downsideDeviation(returns: number[], target = 0): number {
  if (returns.length < 2) throw new QuantError('downsideDeviation: need at least two observations');
  const downside = returns.map((r) => Math.min(0, r - target));
  return Math.sqrt(downside.reduce((acc, r) => acc + r * r, 0) / (returns.length - 1));
}

export function sortinoRatio(returns: number[], riskFreePeriodic = 0): number {
  const dd = downsideDeviation(returns, riskFreePeriodic);
  if (dd === 0) throw new QuantError('sortinoRatio: zero downside deviation');
  return (mean(returns) - riskFreePeriodic) / dd;
}

export function trackingError(assetReturns: number[], benchmarkReturns: number[]): number {
  if (assetReturns.length !== benchmarkReturns.length) throw new QuantError('trackingError: series length mismatch');
  return stdDev(assetReturns.map((r, i) => r - benchmarkReturns[i]));
}
