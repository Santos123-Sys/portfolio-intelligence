import { describe, expect, it } from 'vitest';
import { extractInlineXbrlFundamentals } from '../src/lib/investor-relations';

const context = (id: string, period: string) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="test">123</xbrli:identifier></xbrli:entity><xbrli:period>${period}</xbrli:period></xbrli:context>`;
const duration = (start: string, end: string) => `<xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate>`;
const fact = (name: string, value: string, contextref = 'annual', unitref = 'usd') => `<ix:nonFraction name="us-gaap:${name}" contextRef="${contextref}" unitRef="${unitref}" scale="6">${value}</ix:nonFraction>`;
const header = `${context('annual', duration('2025-01-01', '2025-12-31'))}${context('prior', duration('2024-01-01', '2024-12-31'))}${context('quarter', duration('2026-01-01', '2026-03-31'))}${context('instant', '<xbrli:instant>2025-12-31</xbrli:instant>')}<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><xbrli:unit id="brl"><xbrli:measure>iso4217:BRL</xbrli:measure></xbrli:unit><xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>`;

describe('investor-relations inline XBRL extraction', () => {
  it('takes the latest full year in the requested currency, not the largest historical value', () => {
    const result = extractInlineXbrlFundamentals(`${header}
      ${fact('Revenues', '2,000', 'prior')}
      ${fact('Revenues', '1,000')}
      ${fact('Revenues', '3,000', 'quarter')}
      ${fact('NetCashProvidedByUsedInOperatingActivities', '200')}
      ${fact('PaymentsToAcquirePropertyPlantAndEquipment', '50')}
      ${fact('LongTermDebt', '300', 'instant')}
      ${fact('CashAndCashEquivalentsAtCarryingValue', '100', 'instant')}
      ${fact('RevenueFromContractWithCustomerExcludingAssessedTax', '9,999', 'annual', 'brl')}
      <ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="instant" unitRef="shares" scale="6">20</ix:nonFraction>
    `, 'https://www.sec.gov/ixviewer/doc.html', 'USD');
    expect(result?.periodEnd).toBe('2025-12-31');
    expect(result?.currency).toBe('USD');
    expect(result?.fundamentals).toMatchObject({
      revenue: 1_000_000_000, free_cash_flow: 150_000_000, total_debt: 300_000_000,
      cash_and_equivalents: 100_000_000, shares_outstanding: 20_000_000,
    });
  });

  it('rejects missing reporting contexts, wrong currency and conflicting facts', () => {
    expect(extractInlineXbrlFundamentals(fact('Revenues', '100'), 'https://example.com')).toBeNull();
    expect(extractInlineXbrlFundamentals(header + fact('Revenues', '100'), 'https://example.com', 'CHF')).toBeNull();
    const result = extractInlineXbrlFundamentals(header + fact('Revenues', '100') + fact('Revenues', '120'), 'https://example.com', 'USD');
    expect(result?.fundamentals.revenue).toBeUndefined();
    expect(extractInlineXbrlFundamentals('<table><tr><td>Revenue</td><td>1,000</td></tr></table>', 'https://example.com')).toBeNull();
  });
});
