import PDFDocument from 'pdfkit';
import type { ThreeCaseDcfResult } from './quant/dcf';

const navy = '#102A43';
const blue = '#246B8E';
const teal = '#147D73';
const gold = '#B88932';
const ink = '#17212B';
const muted = '#607080';
const line = '#D9E2E8';
const panel = '#F4F7F9';

function clean(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
}

function amount(currency: string, value: number, decimals = 0): string {
  return `${currency} ${value.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}`;
}

function date(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}

export interface DcfReportInput {
  companyName: string;
  ticker: string;
  exchange: string;
  result: ThreeCaseDcfResult;
  sourceReferences: string[];
}

/** Static PDF rendered only from the stored deterministic result and its retained evidence keys. */
export async function renderDcfReportPdf(input: DcfReportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 52, info: { Title: `${clean(input.ticker)} DCF valuation`, Author: 'Portfolio Intelligence' } });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    const contentWidth = document.page.width - 104;
    document.rect(0, 0, document.page.width, 15).fill(gold);
    document.fillColor(navy).font('Helvetica-Bold').fontSize(10).text('PORTFOLIO INTELLIGENCE', 52, 54);
    document.fillColor(ink).font('Helvetica-Bold').fontSize(24).text(`${clean(input.companyName)}\nDCF valuation`, 52, 94, { width: contentWidth, lineGap: 3 });
    document.fillColor(muted).font('Helvetica').fontSize(10).text(`${clean(input.ticker)} | ${clean(input.exchange)} | Generated ${date(input.result.computedAt)}`, 52, 167);
    document.moveTo(52, 194).lineTo(170, 194).lineWidth(3).strokeColor(gold).stroke();
    document.fillColor(muted).fontSize(9.2).text('Strict automatic model: all financial and scenario drivers were retained as source-linked records. Missing data stops generation; it is not substituted with an unsourced default.', 52, 215, { width: contentWidth, lineGap: 3 });

    document.fillColor(navy).font('Helvetica-Bold').fontSize(12).text('Scenario summary', 52, 286);
    const columns = [52, 218, 384];
    input.result.scenarios.forEach((scenario, index) => {
      const x = columns[index]!;
      const result = scenario.result;
      document.roundedRect(x, 310, 146, 155, 7).fillAndStroke(panel, line);
      document.fillColor(scenario.name === 'base_case' ? teal : blue).font('Helvetica-Bold').fontSize(8.5).text(scenario.label.toUpperCase(), x + 12, 324, { width: 122 });
      document.fillColor(navy).fontSize(16).text(amount(result.currency, result.fairValuePerShare, 2), x + 12, 347, { width: 122 });
      document.fillColor(muted).font('Helvetica').fontSize(7.8).text('Implied value per share', x + 12, 371);
      const rows = [
        ['FCF growth', `${(result.assumptions.annualGrowthRate * 100).toFixed(1)}%`],
        ['Discount rate', `${(result.assumptions.discountRate * 100).toFixed(1)}%`],
        ['Terminal growth', `${(result.assumptions.terminalGrowthRate * 100).toFixed(1)}%`],
        ['Enterprise value', amount(result.currency, result.enterpriseValue)],
      ];
      rows.forEach(([label, value], row) => {
        const y = 393 + row * 16;
        document.fillColor(muted).font('Helvetica').fontSize(7.3).text(label, x + 12, y, { width: 74 });
        document.fillColor(ink).font('Helvetica-Bold').fontSize(7.3).text(value, x + 82, y, { width: 52, align: 'right' });
      });
    });

    document.addPage();
    document.fillColor(navy).font('Helvetica-Bold').fontSize(18).text('Base-case valuation detail');
    const base = input.result.scenarios.find((scenario) => scenario.name === 'base_case')!.result;
    document.fillColor(muted).font('Helvetica').fontSize(9).text(`${clean(input.companyName)} | ${clean(input.ticker)} | Financial evidence as of ${date(base.assumptions.dataAsOf)}`);
    document.moveDown(1.25);
    document.fillColor(navy).font('Helvetica-Bold').fontSize(11).text('Free cash flow projection');
    const startY = document.y + 9;
    document.roundedRect(52, startY, contentWidth, 26, 5).fill(blue);
    document.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8).text('YEAR', 64, startY + 9);
    document.text('FREE CASH FLOW', 175, startY + 9);
    document.text('DISCOUNT FACTOR', 330, startY + 9);
    document.text('PRESENT VALUE', 460, startY + 9);
    base.projections.forEach((projection, index) => {
      const y = startY + 26 + index * 22;
      if (index % 2 === 0) document.rect(52, y, contentWidth, 22).fill(panel);
      document.fillColor(ink).font('Helvetica').fontSize(8.5).text(String(projection.year), 64, y + 7);
      document.text(amount(base.currency, projection.freeCashFlow), 175, y + 7);
      document.text(projection.discountFactor.toFixed(3), 350, y + 7);
      document.text(amount(base.currency, projection.presentValue), 460, y + 7, { width: 90, align: 'right' });
    });
    const bridgeY = startY + 26 + base.projections.length * 22 + 26;
    document.fillColor(navy).font('Helvetica-Bold').fontSize(11).text('Enterprise to equity bridge', 52, bridgeY);
    const bridge = [
      ['PV of explicit free cash flow', base.projections.reduce((sum, item) => sum + item.presentValue, 0)],
      ['PV of terminal value', base.terminalPresentValue],
      ['Enterprise value', base.enterpriseValue],
      ['Net debt', base.assumptions.netDebt],
      ['Equity value', base.equityValue],
      ['Implied value per share', base.fairValuePerShare],
    ];
    bridge.forEach(([label, value], index) => {
      const y = bridgeY + 24 + index * 20;
      document.fillColor(index >= 4 ? navy : muted).font(index >= 4 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.8).text(label as string, 64, y);
      document.text(amount(base.currency, value as number, label === 'Implied value per share' ? 2 : 0), 390, y, { width: 160, align: 'right' });
    });

    document.moveDown(1.6);
    document.fillColor(navy).font('Helvetica-Bold').fontSize(11).text('Method, evidence, and limitations', 52, 600);
    document.fillColor(ink).font('Helvetica').fontSize(8.5).text(clean(input.result.methodology), 52, 621, { width: contentWidth, lineGap: 2.5 });
    document.fillColor(muted).fontSize(7.5).text(`Evidence keys retained in the authenticated platform: ${input.sourceReferences.map(clean).join(', ') || 'none'}.`, 52, 680, { width: contentWidth, lineGap: 2 });
    document.fillColor(muted).fontSize(7.2).text('This is a scenario analysis for human review. It is not investment advice, a price target, or an instruction to trade.', 52, 742, { width: contentWidth });
    document.end();
  });
}

export function dcfReportFileName(ticker: string): string {
  const stem = clean(ticker).replace(/[^A-Za-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'company';
  return `${stem.toLowerCase()}-three-scenario-dcf.pdf`;
}
