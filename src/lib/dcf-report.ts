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
    const hasComps = Boolean(input.result.comparableCompanies);
    const title = hasComps ? 'DCF + Comps valuation' : 'DCF valuation';
    const document = new PDFDocument({ size: 'A4', margin: 52, info: { Title: `${clean(input.ticker)} ${title}`, Author: 'Portfolio Intelligence' } });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    const contentWidth = document.page.width - 104;
    document.rect(0, 0, document.page.width, 15).fill(gold);
    document.fillColor(navy).font('Helvetica-Bold').fontSize(10).text('PORTFOLIO INTELLIGENCE', 52, 54);
    document.fillColor(ink).font('Helvetica-Bold').fontSize(24).text(`${clean(input.companyName)}\n${title}`, 52, 94, { width: contentWidth, lineGap: 3 });
    document.fillColor(muted).font('Helvetica').fontSize(10).text(`${clean(input.ticker)} | ${clean(input.exchange)} | Generated ${date(input.result.computedAt)}`, 52, 167);
    document.moveTo(52, 194).lineTo(170, 194).lineWidth(3).strokeColor(gold).stroke();
    document.fillColor(muted).fontSize(9.2).text('Strict automatic model: all financial and scenario drivers were retained as source-linked records. Missing data stops generation; it is not substituted with an unsourced default.', 52, 215, { width: contentWidth, lineGap: 3 });
    if (input.result.currentPrice) {
      const price = input.result.currentPrice;
      const comparison = price.currency === input.result.currency
        ? ` · Base case ${((input.result.scenarios.find((scenario) => scenario.name === 'base_case')!.result.fairValuePerShare / price.value - 1) * 100).toFixed(1)}% implied difference using perpetuity growth`
        : ' · Currency differs from valuation currency; no cross-currency comparison is shown';
      document.fillColor(navy).font('Helvetica-Bold').fontSize(9).text(`Observed share price: ${amount(price.currency, price.value, 2)} as of ${clean(price.asOf)}${comparison}`, 52, 258, { width: contentWidth, lineGap: 2, link: price.sourceUrl ?? undefined });
    }

    document.fillColor(navy).font('Helvetica-Bold').fontSize(12).text('Scenario summary', 52, 286);
    const columns = [52, 218, 384];
    input.result.scenarios.forEach((scenario, index) => {
      const x = columns[index]!;
      const result = scenario.result;
      document.roundedRect(x, 310, 146, 178, 7).fillAndStroke(panel, line);
      document.fillColor(scenario.name === 'base_case' ? teal : blue).font('Helvetica-Bold').fontSize(8.5).text(scenario.label.toUpperCase(), x + 12, 324, { width: 122 });
      document.fillColor(navy).fontSize(16).text(amount(result.currency, result.fairValuePerShare, 2), x + 12, 347, { width: 122 });
      document.fillColor(muted).font('Helvetica').fontSize(7.8).text('Implied value per share', x + 12, 371);
      const rows: Array<[string, string]> = [
        ['FCF growth', `${(result.assumptions.annualGrowthRate * 100).toFixed(1)}%`],
        ['Discount rate', `${(result.assumptions.discountRate * 100).toFixed(1)}%`],
        ['Terminal growth', `${(result.assumptions.terminalGrowthRate * 100).toFixed(1)}%`],
        ['Enterprise value', amount(result.currency, result.enterpriseValue)],
      ];
      if (result.exitMultipleValuation) rows.push(['Exit value/share', amount(result.currency, result.exitMultipleValuation.fairValuePerShare, 2)]);
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
    if (input.result.costOfCapital) {
      const capital = input.result.costOfCapital;
      document.fillColor(navy).font('Helvetica-Bold').fontSize(10).text('Source-backed WACC');
      document.fillColor(muted).font('Helvetica').fontSize(8.5).text(`Risk-free ${(capital.riskFreeRate * 100).toFixed(2)}% + beta ${capital.beta.toFixed(2)} × market risk premium ${(capital.marketRiskPremium * 100).toFixed(2)}% = cost of equity ${(capital.costOfEquity * 100).toFixed(2)}%. After-tax debt cost ${(capital.afterTaxCostOfDebt * 100).toFixed(2)}%; target debt/capital ${(capital.debtToCapital * 100).toFixed(1)}%; calculated WACC ${(capital.wacc * 100).toFixed(2)}%.`, { width: contentWidth, lineGap: 2 });
      document.moveDown(1.0);
    }
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
    if (input.result.comparableCompanies) {
      const comps = input.result.comparableCompanies.result;
      document.addPage();
      document.rect(0, 0, document.page.width, 15).fill(gold);
      document.fillColor(navy).font('Helvetica-Bold').fontSize(18).text('Comparable companies cross-check', 52, 58);
      document.fillColor(muted).font('Helvetica').fontSize(9).text(`Reviewed peer set · ${comps.statistics.evEbitda.count} valid EV/EBITDA observations · scenario ${clean(input.result.comparableCompanies.scenarioId)}`, 52, 87, { width: contentWidth });
      document.fillColor(navy).font('Helvetica-Bold').fontSize(10).text(`Median EV/EBITDA: ${comps.statistics.evEbitda.median?.toFixed(2) ?? 'N/A'}x`, 52, 122);
      document.fillColor(muted).font('Helvetica').fontSize(8).text('The median is applied to source-backed Year 5 EBITDA in the DCF exit-multiple method. Peer multiples are currency-neutral; each peer’s market capitalization and financial denominators are retained in that peer’s reporting currency.', 52, 144, { width: contentWidth, lineGap: 2.5 });
      const cols = [52, 175, 235, 320, 390, 460];
      document.roundedRect(52, 190, contentWidth, 24, 4).fill(blue);
      document.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5);
      ['PEER', 'TICKER', 'EV / EBITDA', 'EV / REV', 'P / E', 'SOURCE'].forEach((label, i) => document.text(label, cols[i]!, 198, { width: i === 0 ? 116 : 62 }));
      comps.peers.slice(0, 10).forEach((peer, index) => {
        const y = 214 + index * 27;
        if (index % 2 === 0) document.rect(52, y, contentWidth, 27).fill(panel);
        document.fillColor(ink).font('Helvetica').fontSize(7.2);
        document.text(clean(peer.companyName), cols[0]!, y + 8, { width: 116, ellipsis: true });
        document.text(`${clean(peer.ticker)} · ${peer.currency}`, cols[1]!, y + 8, { width: 55 });
        document.text(peer.evEbitda == null ? 'N/A' : `${peer.evEbitda.toFixed(2)}x`, cols[2]!, y + 8, { width: 72 });
        document.text(peer.evRevenue == null ? 'N/A' : `${peer.evRevenue.toFixed(2)}x`, cols[3]!, y + 8, { width: 62 });
        document.text(peer.pe == null ? 'N/A' : `${peer.pe.toFixed(2)}x`, cols[4]!, y + 8, { width: 58 });
        document.fillColor(blue).text(peer.sourceUrl ?? 'Source in scenario record', cols[5]!, y + 5, { width: 88, height: 18, ellipsis: true, link: peer.sourceUrl });
      });
      const caveatY = 214 + Math.min(comps.peers.length, 10) * 27 + 20;
      document.fillColor(navy).font('Helvetica-Bold').fontSize(9).text('Method and evidence limitations', 52, caveatY);
      document.fillColor(muted).font('Helvetica').fontSize(8).text(clean(comps.methodology), 52, caveatY + 18, { width: contentWidth, lineGap: 2.5 });
      comps.caveats.slice(0, 5).forEach((caveat, index) => document.text(`• ${clean(caveat)}`, 58, caveatY + 46 + index * 18, { width: contentWidth - 12 }));
    }
    const baseScenario = input.result.scenarios.find((scenario) => scenario.name === 'base_case')?.result;
    if (baseScenario?.exitMultipleValuation) {
      document.addPage();
      document.rect(0, 0, document.page.width, 15).fill(gold);
      document.fillColor(navy).font('Helvetica-Bold').fontSize(18).text('Base-case sensitivity matrices', 52, 58);
      document.fillColor(muted).font('Helvetica').fontSize(8.5).text('Per-share values are recalculated deterministically from the retained source-backed cash-flow and capital inputs. Cells with invalid rate relationships are unavailable.', 52, 88, { width: contentWidth, lineGap: 2 });
      const waccs = [...new Set(baseScenario.sensitivity.map((cell) => cell.discountRate))].sort((a, b) => a - b);
      const growthRates = [...new Set(baseScenario.sensitivity.map((cell) => cell.terminalGrowthRate))].sort((a, b) => a - b);
      const colX = (index: number) => 124 + index * 82;
      document.fillColor(navy).font('Helvetica-Bold').fontSize(10).text('Perpetuity method · WACC vs. terminal growth', 52, 124);
      document.roundedRect(52, 146, contentWidth, 22, 4).fill(blue);
      document.fillColor('#FFFFFF').fontSize(7.3).text('WACC / g', 58, 153, { width: 62 });
      growthRates.forEach((growth, index) => document.text(`${(growth * 100).toFixed(2)}%`, colX(index), 153, { width: 70, align: 'right' }));
      waccs.forEach((wacc, rowIndex) => {
        const y = 168 + rowIndex * 22;
        if (rowIndex % 2 === 0) document.rect(52, y, contentWidth, 22).fill(panel);
        document.fillColor(ink).font('Helvetica').fontSize(7.4).text(`${(wacc * 100).toFixed(2)}%`, 58, y + 7, { width: 62 });
        growthRates.forEach((growth, colIndex) => {
          const cell = baseScenario.sensitivity.find((item) => Math.abs(item.discountRate - wacc) < 1e-10 && Math.abs(item.terminalGrowthRate - growth) < 1e-10);
          document.text(cell?.fairValuePerShare == null ? 'N/A' : amount(input.result.currency, cell.fairValuePerShare, 2), colX(colIndex), y + 7, { width: 70, align: 'right' });
        });
      });
      const exit = baseScenario.exitMultipleValuation;
      const exitWaccs = [...new Set(exit.sensitivity.map((cell) => cell.discountRate))].sort((a, b) => a - b);
      const exitMultiples = [...new Set(exit.sensitivity.map((cell) => cell.exitMultiple))].sort((a, b) => a - b);
      const exitY = 330;
      document.fillColor(navy).font('Helvetica-Bold').fontSize(10).text('Exit method · WACC vs. peer EV/EBITDA', 52, exitY);
      document.roundedRect(52, exitY + 22, contentWidth, 22, 4).fill(blue);
      document.fillColor('#FFFFFF').fontSize(7.3).text('WACC / multiple', 58, exitY + 29, { width: 62 });
      exitMultiples.forEach((multiple, index) => document.text(`${multiple.toFixed(2)}x`, colX(index), exitY + 29, { width: 70, align: 'right' }));
      exitWaccs.forEach((wacc, rowIndex) => {
        const y = exitY + 44 + rowIndex * 22;
        if (rowIndex % 2 === 0) document.rect(52, y, contentWidth, 22).fill(panel);
        document.fillColor(ink).font('Helvetica').fontSize(7.4).text(`${(wacc * 100).toFixed(2)}%`, 58, y + 7, { width: 62 });
        exitMultiples.forEach((multiple, colIndex) => {
          const cell = exit.sensitivity.find((item) => Math.abs(item.discountRate - wacc) < 1e-10 && Math.abs(item.exitMultiple - multiple) < 1e-10);
          document.text(cell?.fairValuePerShare == null ? 'N/A' : amount(input.result.currency, cell.fairValuePerShare, 2), colX(colIndex), y + 7, { width: 70, align: 'right' });
        });
      });
    }
    document.end();
  });
}

export function dcfReportFileName(ticker: string): string {
  const stem = clean(ticker).replace(/[^A-Za-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'company';
  return `${stem.toLowerCase()}-integrated-dcf-comps.pdf`;
}
