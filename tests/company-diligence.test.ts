import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CompanyDiligence } from '../src/components/company-diligence';
import { LanguageProvider } from '../src/lib/i18n';

const render = (framework: { marketContext: string[]; sectorDrivers: string[]; companyDrivers: string[] }, analysisMode: 'full_fundamentals' | 'limited_research_risk') =>
  renderToStaticMarkup(createElement(LanguageProvider, null, createElement(CompanyDiligence, { framework, analysisMode, sourceUrls: ['https://example.org/filing'] })));

describe('post-discovery diligence', () => {
  it('keeps financial history and sector benchmarks marked as missing for a limited-data run', () => {
    const html = render({ marketContext: ['Demand noted'], sectorDrivers: [], companyDrivers: ['Makes components'] }, 'limited_research_risk');
    expect(html).toContain('Historical financial performance</strong> <span class="badge breach">Evidence needed');
    expect(html).toContain('Sector index comparison</strong> <span class="badge breach">Evidence needed');
    expect(html).toContain('Demand and operating capacity</strong> <span class="badge watch">Context available');
    expect(html).toContain('href="https://example.org/filing"');
  });

  it('does not turn a company description into a verified value-chain conclusion', () => {
    const html = render({ marketContext: [], sectorDrivers: [], companyDrivers: ['Makes components'] }, 'full_fundamentals');
    expect(html).toContain('Historical financial performance</strong> <span class="badge watch">Context available');
    expect(html).toContain('Verify key suppliers, customers, dependencies, substitutes and pricing power');
    expect(html).toContain('Sector index comparison</strong> <span class="badge breach">Evidence needed');
  });
});
