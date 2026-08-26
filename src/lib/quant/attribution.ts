import { QuantError } from './types';

export interface PositionAttributionInput {
  key: string;
  startingWeight: number;
  startValue: number;
  endValue: number;
  externalCashFlow?: number;
}

export interface PositionAttributionResult {
  key: string;
  holdingReturn: number;
  contribution: number;
}

/**
 * Single-period arithmetic return attribution.
 *
 * contribution = starting portfolio weight × holding return.
 * This is intentionally deterministic and does not use AI. For multi-period
 * institutional attribution, link these period-level contributions explicitly.
 */
export function singlePeriodReturnAttribution(inputs: PositionAttributionInput[]): PositionAttributionResult[] {
  if (inputs.length === 0) throw new QuantError('singlePeriodReturnAttribution: empty input');
  return inputs.map((p) => {
    if (p.startValue === 0) throw new QuantError(`singlePeriodReturnAttribution: zero start value for ${p.key}`);
    const adjustedEnd = p.endValue - (p.externalCashFlow ?? 0);
    const holdingReturn = (adjustedEnd - p.startValue) / p.startValue;
    return { key: p.key, holdingReturn, contribution: p.startingWeight * holdingReturn };
  });
}

export function totalAttributedReturn(results: PositionAttributionResult[]): number {
  return results.reduce((acc, r) => acc + r.contribution, 0);
}
