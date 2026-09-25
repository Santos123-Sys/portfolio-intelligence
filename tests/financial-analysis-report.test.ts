import { describe, expect, it } from 'vitest';
import { buildFinancialAnalysisReport, type FinancialObservation } from '../src/lib/financial-analysis-report';
import { renderFinancialReportPdf } from '../src/lib/financial-report-pdf';

const fact = (metricName: string, value: number, observationDate: string, sourceUrl: string, currency = 'BRL'): FinancialObservation => ({
  metricName, valueNumeric: String(value), observationDate, currency, sourceUrl,
  sourceName: sourceUrl, provider: 'investor-relations', status: 'OK', retrievedAt: new Date('2026-09-25'),
});
const input = (observations: FinancialObservation[]) => ({ companyName: 'Empresa Exemplo', ticker: 'EXMP3', exchange: 'BVMF', currency: 'BRL', observations, now: new Date('2026-09-25') });

describe('embedded financial report and optional PDF', () => {
  it('calculates growth only for consecutive annual periods and ratios only from one source', () => {
    const report = buildFinancialAnalysisReport(input([
      fact('revenue', 100, '2024-12-31', 'https://filing.test/2024'),
      fact('revenue', 120, '2025-12-31', 'https://filing.test/2025'),
      fact('operating_income', 24, '2025-12-31', 'https://filing.test/2025'),
      fact('net_income', 12, '2025-12-31', 'https://other.test/2025'),
      fact('free_cash_flow', 30, '2025-12-31', 'https://filing.test/2025', 'USD'),
    ]));
    expect(report.periods[1].revenueGrowth).toBeCloseTo(0.2);
    expect(report.periods[1].operatingMargin).toBeCloseTo(0.2);
    expect(report.periods[1].netMargin).toBeNull();
    expect(report.periods[1].cashConversion).toBeNull();
    expect(report.periods[1].gaps).toContain('net_income');
  });
  it('shows evidence required, and renders a matching PDF from the same report object', async () => {
    const report = buildFinancialAnalysisReport(input([]));
    expect(report.status).toBe('evidence_required');
    const pdf = await renderFinancialReportPdf(report);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
