import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import type { AnalysisOutput, PortfolioAnalysisManifest } from '@portfolio-intelligence/agentic-contract';

const palette = {
  navy: '#13263D',
  blue: '#285A78',
  teal: '#2D7C7B',
  gold: '#C69A45',
  ink: '#17202A',
  muted: '#5D6B78',
  line: '#D9E1E8',
  panel: '#F4F7F9',
  white: '#FFFFFF',
  red: '#9B3B3B',
};

const margin = 54;
const contentWidth = 612 - margin * 2;
const pageBottom = 660;
const require = createRequire(import.meta.url);
const regularFont = require.resolve('@fontsource/inter/files/inter-latin-400-normal.woff');
const boldFont = require.resolve('@fontsource/inter/files/inter-latin-700-normal.woff');

function asText(items: string[]): string {
  return items.length ? items.join('  |  ') : 'None reported.';
}

export async function renderReportPdf(
  manifest: PortfolioAnalysisManifest,
  externalRunId: string
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 60, right: margin, bottom: 58, left: margin },
    autoFirstPage: false,
    bufferPages: true,
    info: {
      Title: `Portfolio intelligence report ${externalRunId}`,
      Author: 'Portfolio Intelligence Agentic System',
      Subject: `Thesis version ${manifest.thesisVersion}`,
      Keywords: 'portfolio analysis, grounded analysis, investment thesis',
      CreationDate: new Date(manifest.generatedAt),
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.registerFont('ReportRegular', regularFont);
  doc.registerFont('ReportBold', boldFont);

  const addContentPage = (eyebrow: string) => {
    doc.addPage();
    doc.rect(0, 0, 612, 30).fill(palette.navy);
    doc.font('ReportBold').fontSize(8).fillColor(palette.white)
      .text('PORTFOLIO INTELLIGENCE', margin, 11);
    doc.font('ReportRegular').fontSize(8).fillColor('#D7E3EC')
      .text(eyebrow.toUpperCase(), margin, 11, { width: contentWidth, align: 'right' });
    doc.x = margin;
    doc.y = 54;
  };

  const ensureSpace = (height: number, eyebrow: string) => {
    if (doc.y + height > pageBottom) addContentPage(eyebrow);
  };

  const sectionTitle = (title: string, eyebrow: string) => {
    ensureSpace(34, eyebrow);
    doc.moveDown(0.35);
    doc.font('ReportBold').fontSize(12).fillColor(palette.navy)
      .text(title.toUpperCase(), margin, doc.y, { width: contentWidth });
    doc.moveTo(margin, doc.y + 4).lineTo(margin + 44, doc.y + 4).lineWidth(2).strokeColor(palette.gold).stroke();
    doc.moveDown(0.8);
  };

  const paragraph = (text: string, eyebrow: string, options: { muted?: boolean; size?: number } = {}) => {
    doc.font('ReportRegular').fontSize(options.size ?? 9.5);
    const height = doc.heightOfString(text, { width: contentWidth, lineGap: 3 });
    ensureSpace(height + 10, eyebrow);
    doc.fillColor(options.muted ? palette.muted : palette.ink)
      .text(text, margin, doc.y, { width: contentWidth, lineGap: 3 });
    doc.moveDown(0.55);
  };

  const bullets = (items: string[], eyebrow: string, emptyLabel = 'None reported.') => {
    const values = items.length ? items : [emptyLabel];
    for (const item of values) {
      doc.font('ReportRegular').fontSize(9.2);
      const height = doc.heightOfString(item, { width: contentWidth - 18, lineGap: 2 });
      ensureSpace(height + 8, eyebrow);
      const y = doc.y + 3;
      doc.circle(margin + 3, y + 2, 2).fill(palette.teal);
      doc.fillColor(palette.ink)
        .text(item, margin + 14, doc.y, { width: contentWidth - 14, lineGap: 2 });
      doc.moveDown(0.35);
    }
  };

  const scorePanel = (analysis: AnalysisOutput, eyebrow: string) => {
    ensureSpace(116, eyebrow);
    const y = doc.y;
    doc.roundedRect(margin, y, contentWidth, 104, 7).fillAndStroke(palette.panel, palette.line);
    doc.font('ReportBold').fontSize(10).fillColor(palette.navy)
      .text(`${analysis.ticker}  |  ${analysis.companyName}`, margin + 14, y + 12, { width: 290 });
    doc.font('ReportBold').fontSize(9).fillColor(analysis.portfolioCandidate ? palette.teal : palette.red)
      .text(analysis.portfolioCandidate ? 'PORTFOLIO CANDIDATE' : 'NOT A CANDIDATE', margin + 330, y + 13, {
        width: 160,
        align: 'right',
      });
    const scores = [
      ['Investment', analysis.investmentScore],
      ['Alignment', analysis.thesisAlignmentScore],
      ['Quality', analysis.qualityScore],
      ['Growth', analysis.growthScore],
      ['Risk', analysis.riskScore],
      ['Dividend', analysis.dividendScore],
    ] as const;
    scores.forEach(([label, value], index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = margin + 14 + column * 163;
      const scoreY = y + 42 + row * 28;
      doc.font('ReportRegular').fontSize(7.5).fillColor(palette.muted).text(label.toUpperCase(), x, scoreY);
      doc.font('ReportBold').fontSize(12).fillColor(palette.navy).text(String(value), x + 82, scoreY - 2, {
        width: 40,
        align: 'right',
      });
      doc.rect(x, scoreY + 13, 118, 3).fill(palette.line);
      doc.rect(x, scoreY + 13, Math.max(1, 118 * value / 100), 3).fill(label === 'Risk' ? palette.gold : palette.teal);
    });
    doc.y = y + 116;
    doc.x = margin;
  };

  doc.addPage();
  doc.rect(0, 0, 612, 792).fill(palette.navy);
  doc.rect(0, 0, 14, 792).fill(palette.gold);
  doc.font('ReportBold').fontSize(10).fillColor('#BFD0DD')
    .text('PORTFOLIO INTELLIGENCE', 64, 78);
  doc.font('ReportBold').fontSize(31).fillColor(palette.white)
    .text('Grounded portfolio\nanalysis report', 64, 148, { width: 450, lineGap: 4 });
  doc.moveTo(64, 270).lineTo(170, 270).lineWidth(4).strokeColor(palette.gold).stroke();
  doc.font('ReportRegular').fontSize(13).fillColor('#D7E3EC')
    .text(`${manifest.portfolios.length} portfolio${manifest.portfolios.length === 1 ? '' : 's'}  |  ` +
      `${manifest.portfolios.reduce((sum, portfolio) => sum + portfolio.analyses.length, 0)} security analyses`, 64, 300);
  doc.roundedRect(64, 390, 484, 142, 10).fill('#1D344C');
  doc.font('ReportBold').fontSize(9).fillColor('#AFC1CF').text('RUN ID', 86, 418);
  doc.font('ReportRegular').fontSize(10).fillColor(palette.white).text(externalRunId, 86, 436, { width: 430 });
  doc.font('ReportBold').fontSize(9).fillColor('#AFC1CF').text('THESIS VERSION', 86, 476);
  doc.font('ReportRegular').fontSize(10).fillColor(palette.white).text(String(manifest.thesisVersion), 210, 476);
  doc.font('ReportBold').fontSize(9).fillColor('#AFC1CF').text('GENERATED', 300, 476);
  doc.font('ReportRegular').fontSize(10).fillColor(palette.white)
    .text(new Date(manifest.generatedAt).toISOString(), 386, 476, { width: 140 });
  doc.font('ReportRegular').fontSize(8.5).fillColor('#AFC1CF')
    .text('Analytical output based exclusively on dashboard-supplied evidence. See the disclaimer and grounding appendix.', 64, 690, {
      width: 470,
      lineGap: 3,
    });

  for (const portfolio of manifest.portfolios) {
    const eyebrow = portfolio.name;
    addContentPage(eyebrow);
    doc.font('ReportBold').fontSize(23).fillColor(palette.navy).text(portfolio.name, margin, doc.y, { width: contentWidth });
    doc.font('ReportRegular').fontSize(9).fillColor(palette.muted)
      .text(`${portfolio.baseCurrency} base currency  |  Thesis version ${manifest.thesisVersion}  |  ${portfolio.analyses.length} securities`, margin, doc.y, { width: contentWidth });
    doc.moveDown(1.2);

    sectionTitle('Executive summary', eyebrow);
    paragraph(portfolio.synthesis.executiveSummary, eyebrow);
    sectionTitle('Thematic highlights', eyebrow);
    bullets(portfolio.synthesis.thematicHighlights, eyebrow);
    sectionTitle('Concentration flags', eyebrow);
    bullets(portfolio.synthesis.concentrationFlags, eyebrow, 'No concentration flag was produced from the supplied weights.');
    sectionTitle('Watchlist and violations', eyebrow);
    bullets(portfolio.synthesis.watchlistAndViolations, eyebrow, 'No watchlist item or thesis violation was reported.');

    sectionTitle('Security scorecards', eyebrow);
    for (const analysis of portfolio.analyses) scorePanel(analysis, eyebrow);

    ensureSpace(284, eyebrow);
    sectionTitle('Per-security narratives', eyebrow);
    for (const narrative of portfolio.synthesis.perSecurityNarratives) {
      const analysis = portfolio.analyses.find((item) => item.ticker === narrative.ticker)!;
      ensureSpace(250, eyebrow);
      doc.font('ReportBold').fontSize(11).fillColor(palette.blue)
        .text(`${analysis.ticker}  |  ${analysis.companyName}`, margin, doc.y, { width: contentWidth });
      doc.font('ReportRegular').fontSize(8).fillColor(palette.muted)
        .text(`Confidence ${(analysis.confidenceScore * 100).toFixed(0)}%  |  Role ${analysis.portfolioRole.replaceAll('_', ' ')}`, margin, doc.y, { width: contentWidth });
      doc.moveDown(0.35);
      paragraph(narrative.narrative, eyebrow);
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('FUNDAMENTAL SUMMARY', margin, doc.y);
      paragraph(analysis.fundamentalSummary, eyebrow, { size: 9 });
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('INVESTMENT THESIS', margin, doc.y);
      paragraph(analysis.investmentThesis, eyebrow, { size: 9 });
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('CATALYSTS', margin, doc.y);
      bullets(analysis.keyCatalysts, eyebrow);
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('RISKS', margin, doc.y);
      bullets(analysis.keyRisks, eyebrow);
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('THESIS BREAKERS', margin, doc.y);
      bullets(analysis.thesisBreakers, eyebrow);
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('INFORMATION GAPS', margin, doc.y);
      bullets(analysis.informationGaps, eyebrow, 'No information gap was reported.');
      doc.moveDown(0.8);
    }

    sectionTitle('Grounding appendix', eyebrow);
    paragraph('The exact dashboard-supplied keys cited by each analysis are listed below. The agentic system did not calculate or enrich these values.', eyebrow, { muted: true });
    for (const analysis of portfolio.analyses) {
      ensureSpace(34, eyebrow);
      doc.font('ReportBold').fontSize(9).fillColor(palette.navy).text(analysis.ticker, margin, doc.y);
      paragraph(asText(analysis.groundedIn), eyebrow, { muted: true, size: 8 });
    }

    sectionTitle('Disclaimer', eyebrow);
    paragraph(portfolio.synthesis.disclaimer, eyebrow, { muted: true, size: 8.5 });
  }

  const range = doc.bufferedPageRange();
  for (let pageIndex = 0; pageIndex < range.count; pageIndex += 1) {
    doc.switchToPage(range.start + pageIndex);
    if (pageIndex === 0) continue;
    doc.moveTo(margin, 685).lineTo(612 - margin, 685).lineWidth(0.5).strokeColor(palette.line).stroke();
    doc.font('ReportRegular').fontSize(7.5).fillColor(palette.muted)
      .text(externalRunId, margin, 693, { width: 360, lineBreak: false });
    doc.text(`${pageIndex + 1} / ${range.count}`, 450, 693, { width: 108, align: 'right', lineBreak: false });
  }

  const finished = new Promise<void>((resolve, reject) => {
    doc.once('end', resolve);
    doc.once('error', reject);
  });
  doc.end();
  await finished;
  return Buffer.concat(chunks);
}
