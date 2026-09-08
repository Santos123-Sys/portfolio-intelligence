import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import type { AnalysisOutput, PortfolioAnalysisManifest, ReportEvidence } from '@portfolio-intelligence/agentic-contract';

const palette = {
  navy: '#102A43', blue: '#246B8E', teal: '#147D73', gold: '#B88932', ink: '#17212B',
  muted: '#607080', line: '#D9E2E8', panel: '#F4F7F9', white: '#FFFFFF', red: '#A33E3E',
  paleTeal: '#EAF5F2', paleGold: '#FBF5E8',
};

const margin = 54;
const pageWidth = 612;
const pageHeight = 792;
const contentWidth = pageWidth - margin * 2;
const pageBottom = 660;
const require = createRequire(import.meta.url);
const regularFont = require.resolve('@fontsource/inter/files/inter-latin-400-normal.woff');
const boldFont = require.resolve('@fontsource/inter/files/inter-latin-700-normal.woff');

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(value));
}

function cleanNarrative(value: string): string {
  const auditMarker = 'Grounding references preserved from the validated analysis:';
  return value.split(auditMarker)[0]?.trim() || value.trim();
}

function roleLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function average(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function metricLabel(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
}

function metricValue(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
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
      Title: 'Investment Research and Risk Report',
      Author: 'Portfolio Intelligence',
      Subject: `Decision support for thesis version ${manifest.thesisVersion}`,
      Keywords: 'investment research, thesis alignment, risk assessment, decision support',
      CreationDate: new Date(manifest.generatedAt),
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.registerFont('ReportRegular', regularFont);
  doc.registerFont('ReportBold', boldFont);

  const addContentPage = (eyebrow: string) => {
    doc.addPage();
    doc.rect(0, 0, pageWidth, 32).fill(palette.navy);
    doc.font('ReportBold').fontSize(8).fillColor(palette.white)
      .text('PORTFOLIO INTELLIGENCE', margin, 12);
    doc.font('ReportRegular').fontSize(8).fillColor('#D7E3EC')
      .text(eyebrow.toUpperCase(), margin, 12, { width: contentWidth, align: 'right' });
    doc.x = margin;
    doc.y = 55;
  };

  const ensureSpace = (height: number, eyebrow: string) => {
    if (doc.y + height > pageBottom) addContentPage(eyebrow);
  };

  const sectionTitle = (title: string, eyebrow: string) => {
    ensureSpace(38, eyebrow);
    doc.moveDown(0.35);
    doc.font('ReportBold').fontSize(11).fillColor(palette.navy)
      .text(title.toUpperCase(), margin, doc.y, { width: contentWidth, characterSpacing: 0.3 });
    const lineY = doc.y + 4;
    doc.moveTo(margin, lineY).lineTo(margin + 42, lineY).lineWidth(2).strokeColor(palette.gold).stroke();
    doc.moveDown(0.75);
  };

  const paragraph = (
    value: string,
    eyebrow: string,
    options: { muted?: boolean; size?: number; bold?: boolean } = {}
  ) => {
    const text = cleanNarrative(value);
    doc.font(options.bold ? 'ReportBold' : 'ReportRegular').fontSize(options.size ?? 9.3);
    const height = doc.heightOfString(text, { width: contentWidth, lineGap: 3 });
    ensureSpace(height + 9, eyebrow);
    doc.fillColor(options.muted ? palette.muted : palette.ink)
      .text(text, margin, doc.y, { width: contentWidth, lineGap: 3 });
    doc.moveDown(0.5);
  };

  const bullets = (items: string[], eyebrow: string, emptyLabel = 'None reported.') => {
    const values = items.length ? items : [emptyLabel];
    for (const item of values) {
      const text = cleanNarrative(item);
      doc.font('ReportRegular').fontSize(9.1);
      const height = doc.heightOfString(text, { width: contentWidth - 18, lineGap: 2 });
      ensureSpace(height + 8, eyebrow);
      const y = doc.y + 3;
      doc.circle(margin + 3, y + 2, 2).fill(palette.teal);
      doc.fillColor(palette.ink)
        .text(text, margin + 14, doc.y, { width: contentWidth - 14, lineGap: 2 });
      doc.moveDown(0.32);
    }
  };

  const labelValue = (label: string, value: string, x: number, y: number, width: number, light = false) => {
    doc.font('ReportBold').fontSize(7.5).fillColor(light ? '#AFC4D3' : palette.muted)
      .text(label.toUpperCase(), x, y, { width });
    doc.font('ReportRegular').fontSize(10).fillColor(light ? palette.white : palette.ink)
      .text(value, x, y + 16, { width });
  };

  const scorePanel = (analysis: AnalysisOutput, eyebrow: string) => {
    ensureSpace(130, eyebrow);
    const y = doc.y;
    doc.roundedRect(margin, y, contentWidth, 116, 7).fillAndStroke(palette.panel, palette.line);
    doc.font('ReportBold').fontSize(11).fillColor(palette.navy)
      .text(`${analysis.ticker}  |  ${analysis.companyName}`, margin + 14, y + 13, { width: 300 });
    doc.font('ReportBold').fontSize(8.5)
      .fillColor(analysis.portfolioCandidate ? palette.teal : palette.red)
      .text(
        analysis.portfolioCandidate ? 'SUPPORTED FOR FURTHER REVIEW' : 'NOT SUPPORTED BY CURRENT EVIDENCE',
        margin + 314, y + 14, { width: 176, align: 'right' }
      );
    const scores = [
      ['Investment', analysis.investmentScore], ['Thesis fit', analysis.thesisAlignmentScore],
      ['Quality', analysis.qualityScore], ['Growth', analysis.growthScore],
      ['Risk severity', analysis.riskScore], ['Dividend', analysis.dividendScore],
    ] as const;
    scores.forEach(([label, value], index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = margin + 14 + column * 163;
      const scoreY = y + 48 + row * 29;
      doc.font('ReportRegular').fontSize(7.2).fillColor(palette.muted).text(label.toUpperCase(), x, scoreY);
      doc.font('ReportBold').fontSize(11).fillColor(palette.navy).text(String(value), x + 82, scoreY - 2, {
        width: 36, align: 'right',
      });
      doc.rect(x, scoreY + 14, 118, 3).fill(palette.line);
      doc.rect(x, scoreY + 14, Math.max(1, 118 * value / 100), 3)
        .fill(label === 'Risk severity' ? palette.gold : palette.teal);
    });
    doc.y = y + 130;
    doc.x = margin;
  };

  const riskPanel = (evidence: ReportEvidence | undefined, eyebrow: string) => {
    if (!evidence?.riskMetrics.length) return;
    const metrics = evidence.riskMetrics.slice(0, 4);
    ensureSpace(98, eyebrow);
    const y = doc.y;
    doc.roundedRect(margin, y, contentWidth, 84, 7).fillAndStroke(palette.panel, palette.line);
    doc.font('ReportBold').fontSize(8).fillColor(palette.navy)
      .text('PRICE-RISK DASHBOARD', margin + 14, y + 12);
    metrics.forEach((metric, index) => {
      const x = margin + 14 + index * 124;
      const label = metricLabel(metric.name);
      doc.font('ReportRegular').fontSize(7.1).fillColor(palette.muted)
        .text(label.toUpperCase(), x, y + 32, { width: 112 });
      doc.font('ReportBold').fontSize(11).fillColor(palette.navy)
        .text(metricValue(metric.value), x, y + 45, { width: 112 });
      doc.rect(x, y + 67, 102, 3).fill(palette.line);
      doc.rect(x, y + 67, Math.max(2, Math.min(102, metric.value * 250)), 3).fill(palette.gold);
    });
    doc.y = y + 96;
    doc.x = margin;
  };

  const analyses = manifest.portfolios.flatMap((portfolio) => portfolio.analyses);
  const supportedCount = analyses.filter((analysis) => analysis.portfolioCandidate).length;
  const singleSecurity = analyses.length === 1 ? analyses[0] : null;
  const singlePortfolio = manifest.portfolios.length === 1 ? manifest.portfolios[0] : null;
  const singleEvidence = singlePortfolio?.evidence?.find((item) => item.ticker === singleSecurity?.ticker);

  // Cover: decision context first. The internal job identifier is deliberately
  // excluded and appears only once in the final audit note.
  doc.addPage();
  doc.rect(0, 0, pageWidth, pageHeight).fill(palette.navy);
  doc.rect(0, 0, 14, pageHeight).fill(palette.gold);
  doc.font('ReportBold').fontSize(10).fillColor('#BFD0DD')
    .text('PORTFOLIO INTELLIGENCE', 64, 74, { characterSpacing: 0.6 });
  doc.font('ReportBold').fontSize(singleSecurity ? 25 : 30).fillColor(palette.white)
    .text(singleSecurity ? `${singleSecurity.companyName}\nInvestment Research Report` : 'Investment Research\n& Risk Report', 64, 145, { width: 470, lineGap: 4 });
  doc.moveTo(64, 257).lineTo(170, 257).lineWidth(4).strokeColor(palette.gold).stroke();
  doc.font('ReportRegular').fontSize(12).fillColor('#D7E3EC')
    .text(singleSecurity ? `${singleSecurity.ticker} | ${singleEvidence?.exchange ?? 'Exchange not supplied'} | ${singlePortfolio?.name ?? 'Investment research'}` : 'Decision-ready analysis for human review', 64, 283, { width: 470 });

  doc.roundedRect(64, 362, 484, 150, 10).fill('#183852');
  labelValue(singleSecurity ? 'Decision status' : 'Coverage', singleSecurity ? (singleSecurity.portfolioCandidate ? 'Further review' : 'Do not advance') : `${manifest.portfolios.length} portfolio${manifest.portfolios.length === 1 ? '' : 's'}`, 86, 389, 120, true);
  labelValue(singleSecurity ? 'Evidence confidence' : 'Securities reviewed', singleSecurity ? `${Math.round(singleSecurity.confidenceScore * 100)}%` : String(analyses.length), 226, 389, 130, true);
  labelValue(singleSecurity ? 'Latest close' : 'Supported for review', singleSecurity ? (singleEvidence?.latestClose == null ? 'Not supplied' : `${singleEvidence.currency} ${singleEvidence.latestClose.toLocaleString(undefined, { maximumFractionDigits: 2 })}`) : String(supportedCount), 386, 389, 130, true);
  labelValue(singleSecurity ? 'Sector / country' : 'Thesis version', singleSecurity ? `${singleEvidence?.sector ?? 'Not supplied'} / ${singleEvidence?.country ?? 'Not supplied'}` : String(manifest.thesisVersion), 86, 452, 120, true);
  labelValue('Prepared', formatDate(manifest.generatedAt), 226, 452, 140, true);
  labelValue(singleSecurity ? 'Data as of' : 'Average confidence', singleSecurity ? formatDate(singleEvidence?.dataAsOf ?? manifest.generatedAt) : `${average(analyses.map((analysis) => analysis.confidenceScore * 100))}%`, 386, 452, 140, true);

  doc.font('ReportRegular').fontSize(8.7).fillColor('#BFD0DD')
    .text(
      'This report summarizes thesis alignment, evidence quality, catalysts, and downside risks. It supports—rather than replaces—human investment judgment.',
      64, 676, { width: 470, lineGap: 3 }
    );

  for (const portfolio of manifest.portfolios) {
    const eyebrow = portfolio.name;
    const portfolioSupported = portfolio.analyses.filter((analysis) => analysis.portfolioCandidate).length;
    addContentPage(eyebrow);
    doc.font('ReportBold').fontSize(22).fillColor(palette.navy).text(portfolio.name, margin, doc.y, { width: contentWidth });
    doc.font('ReportRegular').fontSize(9).fillColor(palette.muted)
      .text(`${portfolio.baseCurrency} mandate  |  ${portfolio.analyses.length} securities reviewed  |  ${portfolioSupported} supported for further review`, margin, doc.y, { width: contentWidth });
    doc.moveDown(1.1);

    ensureSpace(86, eyebrow);
    const overviewY = doc.y;
    doc.roundedRect(margin, overviewY, contentWidth, 72, 7).fillAndStroke(palette.paleTeal, '#CDE4DE');
    doc.font('ReportBold').fontSize(8).fillColor(palette.teal).text('PORTFOLIO DECISION SNAPSHOT', margin + 14, overviewY + 12);
    labelValue('Average investment score', String(average(portfolio.analyses.map((analysis) => analysis.investmentScore))), margin + 14, overviewY + 32, 150);
    labelValue('Average thesis alignment', String(average(portfolio.analyses.map((analysis) => analysis.thesisAlignmentScore))), margin + 180, overviewY + 32, 150);
    labelValue('Average evidence confidence', `${average(portfolio.analyses.map((analysis) => analysis.confidenceScore * 100))}%`, margin + 346, overviewY + 32, 150);
    doc.y = overviewY + 86;

    sectionTitle('Executive decision summary', eyebrow);
    paragraph(portfolio.synthesis.executiveSummary, eyebrow);
    sectionTitle('Key themes', eyebrow);
    bullets(portfolio.synthesis.thematicHighlights, eyebrow);
    sectionTitle('Portfolio-level risks', eyebrow);
    bullets(portfolio.synthesis.concentrationFlags, eyebrow, 'No concentration flag was produced from the available position data.');
    sectionTitle('Watchlist and mandate checks', eyebrow);
    bullets(portfolio.synthesis.watchlistAndViolations, eyebrow, 'No watchlist item or mandate violation was reported.');

    sectionTitle('Security scorecards', eyebrow);
    for (const analysis of portfolio.analyses) scorePanel(analysis, eyebrow);

    sectionTitle('Security research', eyebrow);
    for (const analysis of portfolio.analyses) {
      const evidence = portfolio.evidence?.find((item) => item.ticker === analysis.ticker);
      const narrative = portfolio.synthesis.perSecurityNarratives.find((item) => item.ticker === analysis.ticker);
      ensureSpace(116, eyebrow);
      doc.font('ReportBold').fontSize(13).fillColor(palette.blue)
        .text(`${analysis.ticker}  |  ${analysis.companyName}`, margin, doc.y, { width: contentWidth });
      doc.font('ReportRegular').fontSize(8).fillColor(palette.muted)
        .text(
          `${roleLabel(analysis.portfolioRole)}  |  Evidence confidence ${(analysis.confidenceScore * 100).toFixed(0)}%  |  ${analysis.groundedIn.length} validated references`,
          margin, doc.y, { width: contentWidth }
        );
      doc.moveDown(0.45);

      ensureSpace(56, eyebrow);
      const decisionY = doc.y;
      doc.roundedRect(margin, decisionY, contentWidth, 42, 6)
        .fill(analysis.portfolioCandidate ? palette.paleTeal : palette.paleGold);
      doc.font('ReportBold').fontSize(8).fillColor(analysis.portfolioCandidate ? palette.teal : palette.gold)
        .text('DECISION VIEW', margin + 12, decisionY + 8);
      doc.font('ReportRegular').fontSize(9).fillColor(palette.ink)
        .text(
          analysis.portfolioCandidate
            ? 'Current evidence supports further due diligence; this is not an instruction to trade.'
            : 'Current evidence does not support advancing this security without resolving the stated gaps.',
          margin + 12, decisionY + 21, { width: contentWidth - 24 }
        );
      doc.y = decisionY + 54;

      if (narrative) paragraph(narrative.narrative, eyebrow);
      sectionTitle('Company profile and research scope', eyebrow);
      paragraph(
        `${analysis.companyName} (${analysis.ticker}) trades on ${evidence?.exchange ?? 'the supplied exchange'}. ${evidence?.sector ?? 'Sector classification was not supplied'}${evidence?.country ? `, ${evidence.country}` : ''}. Data in this report is current to ${formatDate(evidence?.dataAsOf ?? manifest.generatedAt)} and is expressed in ${evidence?.currency ?? 'the supplied currency'}.`,
        eyebrow,
        { size: 9 }
      );
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('BUSINESS ACTIVITIES', margin, doc.y);
      bullets(
        analysis.researchFramework.companyDrivers,
        eyebrow,
        'The supplied research did not document the company\'s activities, products, services, customers, or revenue model.'
      );
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('MARKET CONTEXT', margin, doc.y);
      bullets(
        [...analysis.researchFramework.marketContext, ...analysis.researchFramework.sectorDrivers],
        eyebrow,
        'The supplied research did not document the relevant market, customer environment, or sector economics.'
      );
      if (evidence?.analysisMode === 'limited_research_risk') {
        paragraph('Research scope: limited-data research and price-risk assessment. Structured financial statements were not supplied, so DCF valuation is intentionally locked.', eyebrow, { muted: true, size: 8.8 });
      }
      riskPanel(evidence, eyebrow);
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('RESEARCH FRAMEWORK', margin, doc.y);
      paragraph(`Coverage rationale: ${analysis.researchFramework.coverageRationale}`, eyebrow, { size: 9 });
      ensureSpace(84, eyebrow);
      const frameworkY = doc.y;
      doc.roundedRect(margin, frameworkY, contentWidth, 70, 6).fillAndStroke(palette.panel, palette.line);
      labelValue('Evidence quality', roleLabel(analysis.researchFramework.evidenceQuality), margin + 12, frameworkY + 11, 150);
      labelValue('Scenario readiness', roleLabel(analysis.researchFramework.scenarioReadiness), margin + 190, frameworkY + 11, 150);
      labelValue('Monitoring triggers', String(analysis.researchFramework.monitoringTriggers.length), margin + 368, frameworkY + 11, 125);
      doc.y = frameworkY + 82;
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('MARKET AND SECTOR CONTEXT', margin, doc.y);
      bullets([
        ...analysis.researchFramework.marketContext,
        ...analysis.researchFramework.sectorDrivers,
      ], eyebrow, 'Not evidenced in the current research pack.');
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('COMPANY AND VALUATION DRIVERS', margin, doc.y);
      bullets([
        ...analysis.researchFramework.companyDrivers,
        ...analysis.researchFramework.criticalValuationDrivers,
      ], eyebrow, 'Not ready without further validated financial evidence.');
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('MONITORING TRIGGERS', margin, doc.y);
      bullets(analysis.researchFramework.monitoringTriggers, eyebrow);
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('EVIDENCE COVERAGE', margin, doc.y);
      paragraph(analysis.fundamentalSummary, eyebrow, { size: 9 });
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('INVESTMENT CASE AND COUNTER-CASE', margin, doc.y);
      paragraph(analysis.investmentThesis, eyebrow, { size: 9 });
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('CATALYSTS', margin, doc.y);
      bullets(analysis.keyCatalysts, eyebrow);
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('PRINCIPAL RISKS', margin, doc.y);
      bullets(analysis.keyRisks, eyebrow);
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('THESIS BREAKERS', margin, doc.y);
      bullets(analysis.thesisBreakers, eyebrow);
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('INFORMATION GAPS', margin, doc.y);
      bullets(analysis.informationGaps, eyebrow, 'No information gap was reported.');
      doc.font('ReportBold').fontSize(8).fillColor(palette.navy).text('SELECTED PUBLIC RESEARCH SOURCES', margin, doc.y);
      if (evidence?.sourceUrls.length) {
        for (const url of evidence.sourceUrls) {
          ensureSpace(23, eyebrow);
          doc.font('ReportRegular').fontSize(8).fillColor(palette.blue)
            .text(url, margin, doc.y, { width: contentWidth, link: url, underline: true });
          doc.moveDown(0.28);
        }
      } else {
        paragraph('No public web source was retained in the validated research bundle. This report does not invent or substitute sources.', eyebrow, { muted: true, size: 8.6 });
      }
      doc.moveDown(0.9);
    }

    sectionTitle('Method and limitations', eyebrow);
    paragraph(
      `The analysis used ${portfolio.analyses.reduce((sum, analysis) => sum + analysis.groundedIn.length, 0)} validated evidence references across this portfolio. Internal evidence keys are retained in the audit system and are intentionally omitted from this reader-facing report.`,
      eyebrow, { muted: true, size: 8.7 }
    );
    paragraph(portfolio.synthesis.disclaimer, eyebrow, { muted: true, size: 8.5 });
  }

  addContentPage('Report governance');
  sectionTitle('Report governance', 'Report governance');
  paragraph(
    'This document is a decision-support artifact. It does not place trades, alter portfolio holdings, or substitute for suitability, tax, legal, or regulated investment advice.',
    'Report governance'
  );
  sectionTitle('Evidence handling', 'Report governance');
  bullets([
    'Scores and narratives are generated from the validated evidence supplied to the research workflow.',
    'Missing information is identified explicitly; it is not silently estimated or invented.',
    'Detailed evidence keys and processing logs remain available in the authenticated audit system.',
  ], 'Report governance');
  sectionTitle('Audit reference', 'Report governance');
  paragraph('Use this reference only when investigating the report with an administrator or support specialist.', 'Report governance', { muted: true });
  ensureSpace(52, 'Report governance');
  const auditY = doc.y;
  doc.roundedRect(margin, auditY, contentWidth, 38, 6).fillAndStroke(palette.panel, palette.line);
  doc.font('ReportRegular').fontSize(8).fillColor(palette.muted)
    .text(externalRunId, margin + 12, auditY + 13, { width: contentWidth - 24 });
  doc.y = auditY + 52;

  const range = doc.bufferedPageRange();
  for (let pageIndex = 0; pageIndex < range.count; pageIndex += 1) {
    doc.switchToPage(range.start + pageIndex);
    if (pageIndex === 0) continue;
    doc.moveTo(margin, 685).lineTo(pageWidth - margin, 685).lineWidth(0.5).strokeColor(palette.line).stroke();
    doc.font('ReportRegular').fontSize(7.5).fillColor(palette.muted)
      .text('Portfolio Intelligence  |  Confidential decision support', margin, 693, { width: 360, lineBreak: false });
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
