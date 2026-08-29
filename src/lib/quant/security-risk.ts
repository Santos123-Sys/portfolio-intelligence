import type { DailyBar } from '../connectors/base';
import { toReturnSeries } from './returns';
import { maxDrawdown, valueAtRisk, volatility } from './risk';
import type { Currency, RiskMetric } from './types';
import { QuantError } from './types';

export function computeStandaloneSecurityRisk(bars: DailyBar[]): RiskMetric[] {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 31) {
    throw new QuantError(`Standalone security risk needs at least 31 price observations; received ${sorted.length}`);
  }
  const currencies = new Set(sorted.map((bar) => bar.currency));
  if (currencies.size !== 1) throw new QuantError('Standalone security risk cannot mix currencies');
  const currency = sorted[0].currency as Currency;
  if (!['CHF', 'BRL', 'USD', 'EUR'].includes(currency)) {
    throw new QuantError(`Unsupported risk currency ${currency}`);
  }
  const points = sorted.map((bar) => ({ date: bar.date, value: bar.close }));
  const returns = toReturnSeries(points);
  const context = { currency, dataAsOf: new Date(`${sorted.at(-1)!.date}T00:00:00.000Z`).toISOString() };
  const historical = valueAtRisk(returns, context, { method: 'historical', confidenceLevel: 0.95, horizonDays: 1 });
  historical.metricName = 'VaR_95_1d_Historical';
  const parametric = valueAtRisk(returns, context, { method: 'parametric', confidenceLevel: 0.95, horizonDays: 1 });
  parametric.metricName = 'VaR_95_1d_Parametric';
  return [
    volatility(returns, context),
    maxDrawdown(points.map((point) => point.value), context),
    historical,
    parametric,
  ];
}
