import { describe, expect, it } from 'vitest';
import { extractSecAnnualFilings } from '../src/lib/sec-companyfacts';

const annual = (val: number, end: string, accn: string, filed: string, form = '10-K', start?: string) => ({
  val, end, accn, filed, form, start, fy: Number(end.slice(0, 4)), fp: 'FY',
});
const accn24 = '0000320193-24-000001';
const accn25 = '0000320193-25-000001';
const data = {
  cik: 320193, entityName: 'APPLE INC.', facts: {
    'us-gaap': {
      Revenues: { units: { USD: [
        annual(180, '2024-09-28', accn24, '2024-11-01', '10-K', '2023-10-01'),
        annual(100, '2025-09-27', accn25, '2025-11-01', '10-K', '2024-09-29'),
        annual(900, '2026-03-31', accn25, '2025-11-01', '10-Q', '2026-01-01'),
      ] } },
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: [annual(30, '2025-09-27', accn25, '2025-11-01', '10-K', '2024-09-29')] } },
      PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [annual(10, '2025-09-27', accn25, '2025-11-01', '10-K', '2024-09-29')] } },
      LongTermDebt: { units: { USD: [annual(20, '2025-09-27', accn25, '2025-11-01')] } },
    },
  },
};

describe('SEC Company Facts', () => {
  it('keeps annual, same-accession facts by period and derives FCF', () => {
    const result = extractSecAnnualFilings(data, 'Apple Inc', 'USD');
    expect(result.map((r) => r.periodEnd)).toEqual(['2024-09-28', '2025-09-27']);
    expect(result[1].fundamentals).toMatchObject({ revenue: 100, free_cash_flow: 20, total_debt: 20 });
    expect(result[1].sourceName).toContain(accn25);
  });
  it('rejects issuer mismatch and conflicting facts in one filing', () => {
    expect(extractSecAnnualFilings(data, 'Microsoft Corp', 'USD')).toEqual([]);
    const conflicting = structuredClone(data);
    conflicting.facts['us-gaap'].Revenues.units.USD.push(annual(999, '2025-09-27', accn25, '2025-11-01', '10-K', '2024-09-29'));
    expect(extractSecAnnualFilings(conflicting, 'Apple Inc', 'USD')[1].fundamentals.revenue).toBeUndefined();
  });
});
