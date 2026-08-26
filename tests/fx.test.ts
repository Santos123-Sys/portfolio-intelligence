import { describe, it, expect } from 'vitest';
import { deriveRate, displayTotal } from '../src/lib/fx';
import { Currency } from '../src/lib/quant/types';

const perEur = { EUR: 1, CHF: 0.94, BRL: 6.2, USD: 1.08 };

describe('FX triangulation', () => {
  it('returns 1 for identical currencies', () => {
    expect(deriveRate(perEur, 'CHF', 'CHF')).toBe(1);
  });

  it('triangulates CHF to BRL through EUR', () => {
    // 1 CHF = (1/0.94) EUR = 6.2/0.94 BRL
    expect(deriveRate(perEur, 'CHF', 'BRL')).toBeCloseTo(6.2 / 0.94, 10);
  });

  it('is exactly reciprocal in both directions', () => {
    const a = deriveRate(perEur, 'CHF', 'BRL');
    const b = deriveRate(perEur, 'BRL', 'CHF');
    expect(a * b).toBeCloseTo(1, 12);
  });

  it('throws on an unknown currency rather than defaulting', () => {
    expect(() => deriveRate(perEur, 'CHF', 'JPY' as Currency)).toThrow(/No ECB rate/);
  });
});

describe('displayTotal (the only sanctioned cross-currency operation)', () => {
  const portfolios = [
    { portfolioId: 'p1', name: 'Swiss Quality', valueNative: 100000, currency: 'CHF' as Currency },
    { portfolioId: 'p2', name: 'Brazilian Growth', valueNative: 500000, currency: 'BRL' as Currency },
  ];

  it('converts every component and shows the rate used', () => {
    const r = displayTotal(portfolios, 'CHF', perEur, '2026-08-25');
    expect(r.components).toHaveLength(2);
    expect(r.components[0].rateApplied).toBe(1);
    expect(r.components[1].rateApplied).toBeCloseTo(0.94 / 6.2, 10);
  });

  it('sums converted components', () => {
    const r = displayTotal(portfolios, 'CHF', perEur, '2026-08-25');
    const expected = 100000 + 500000 * (0.94 / 6.2);
    expect(r.convertedTotal).toBeCloseTo(expected, 6);
  });

  it('always carries a disclaimer naming the rate date', () => {
    const r = displayTotal(portfolios, 'BRL', perEur, '2026-08-25');
    expect(r.disclaimer).toContain('2026-08-25');
    expect(r.disclaimer).toMatch(/Display only/i);
  });

  it('gives a different total per display currency — proving it is cosmetic', () => {
    const chf = displayTotal(portfolios, 'CHF', perEur, '2026-08-25').convertedTotal;
    const brl = displayTotal(portfolios, 'BRL', perEur, '2026-08-25').convertedTotal;
    expect(chf).not.toBeCloseTo(brl, 2);
    expect(brl).toBeCloseTo(chf * (6.2 / 0.94), 4);
  });
});
