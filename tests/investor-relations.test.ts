import { describe, expect, it } from 'vitest';
import { extractInlineXbrlFundamentals } from '../src/lib/investor-relations';

describe('investor-relations inline XBRL extraction', () => {
  it('extracts primary-source DCF fields and derives free cash flow deterministically', () => {
    const result = extractInlineXbrlFundamentals(`
      <ix:nonFraction name="us-gaap:Revenues" scale="6">1,000</ix:nonFraction>
      <ix:nonFraction name="us-gaap:NetCashProvidedByUsedInOperatingActivities" scale="6">200</ix:nonFraction>
      <ix:nonFraction name="us-gaap:PaymentsToAcquirePropertyPlantAndEquipment" scale="6">50</ix:nonFraction>
      <ix:nonFraction name="us-gaap:LongTermDebt" scale="6">300</ix:nonFraction>
      <ix:nonFraction name="us-gaap:CashAndCashEquivalentsAtCarryingValue" scale="6">100</ix:nonFraction>
      <ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" scale="6">20</ix:nonFraction>
    `, 'https://www.sec.gov/ixviewer/doc.html');
    expect(result?.fundamentals).toMatchObject({
      revenue: 1_000_000_000,
      free_cash_flow: 150_000_000,
      total_debt: 300_000_000,
      cash_and_equivalents: 100_000_000,
      shares_outstanding: 20_000_000,
    });
  });

  it('does not fabricate values from generic HTML', () => {
    expect(extractInlineXbrlFundamentals('<table><tr><td>Revenue</td><td>1,000</td></tr></table>', 'https://example.com')).toBeNull();
  });
});
