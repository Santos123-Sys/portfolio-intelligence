import PDFDocument from 'pdfkit';
import type { FinancialAnalysisReport } from './financial-analysis-report';

const safe = (value: string) => value.replace(/[\u0000-\u001f]/g, '').slice(0, 250);
const fmt = (value: number | undefined, currency: string) => value == null ? 'Unavailable' : `${currency} ${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const pct = (value: number | null) => value == null ? 'Unavailable' : `${(value * 100).toFixed(1)}%`;

/** PDF and embedded page consume the identical, authenticated report model. */
export function renderFinancialReportPdf(report: FinancialAnalysisReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48,
      info: { Title: `${safe(report.companyName)} financial analysis`, Author: 'Portfolio Intelligence' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const width = doc.page.width - 96;
    doc.rect(0, 0, doc.page.width, 10).fill('#B88932');
    doc.fillColor('#102A43').font('Helvetica-Bold').fontSize(20).text(safe(report.companyName), 48, 52, { width });
    doc.fontSize(13).text('Financial analysis report');
    doc.fillColor('#607080').font('Helvetica').fontSize(9)
      .text(`${safe(report.ticker)} · ${safe(report.exchange)} · ${safe(report.currency)} · Generated ${report.generatedAt.slice(0, 10)}`);
    doc.moveDown(1.5);
    if (!report.periods.length) doc.fillColor('#A34B38').text('Evidence required: no supported annual financial facts have been imported.');
    for (const row of report.periods) {
      if (doc.y > 590) doc.addPage();
      doc.fillColor('#102A43').font('Helvetica-Bold').fontSize(12).text(`Fiscal period ending ${row.periodEnd}`);
      doc.fillColor('#17212B').font('Helvetica').fontSize(9)
        .text(`Revenue: ${fmt(row.metrics.revenue, report.currency)}   Growth: ${pct(row.revenueGrowth)}`)
        .text(`Operating income: ${fmt(row.metrics.operating_income, report.currency)}   Margin: ${pct(row.operatingMargin)}`)
        .text(`Net income: ${fmt(row.metrics.net_income, report.currency)}   Margin: ${pct(row.netMargin)}`)
        .text(`Free cash flow: ${fmt(row.metrics.free_cash_flow, report.currency)}   FCF / revenue: ${pct(row.cashConversion)}`)
        .text(`Total debt: ${fmt(row.metrics.total_debt, report.currency)}   Cash: ${fmt(row.metrics.cash_and_equivalents, report.currency)}`);
      doc.fillColor('#607080').fontSize(8).text(`Source: ${safe(row.sourceName)} · ${safe(row.sourceUrl)}`, { width, link: row.sourceUrl });
      if (row.gaps.length) doc.fillColor('#A34B38').text(`Missing or conflicting: ${row.gaps.join(', ')}`);
      doc.moveDown(1.2);
    }
    doc.fillColor('#102A43').font('Helvetica-Bold').fontSize(11).text('Method and limitations');
    doc.fillColor('#607080').font('Helvetica').fontSize(8.5)
      .text('Ratios use reported facts from a single filing per annual period. No missing values are estimated. Figures retain the issuer filing currency; this is not a valuation or trade instruction.');
    report.limitations.forEach((item) => doc.text(`• ${safe(item)}`));
    doc.end();
  });
}
