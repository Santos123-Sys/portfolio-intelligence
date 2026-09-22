import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const setupPage = readFileSync('src/app/portfolio-setup/page.tsx', 'utf8');
const positionsPage = readFileSync('src/app/positions/page.tsx', 'utf8');
const header = readFileSync('src/components/header.tsx', 'utf8');
const portfolioWorkspaceNav = readFileSync('src/components/portfolio-workspace-nav.tsx', 'utf8');
const i18n = readFileSync('src/lib/i18n.tsx', 'utf8');

describe('discovery-first workflow', () => {
  it('does not make a position a prerequisite for discovery', () => {
    expect(setupPage).toContain("redirect('/positions#add-position')");
    expect(positionsPage).toContain('Approving a research candidate does not add a holding automatically.');
    expect(positionsPage).toContain('Record a holding');
  });

  it('puts the investment workflow in primary navigation and related portfolio tools in one workspace', () => {
    expect(header).toContain("['/investment-thesis', 'nav.thesis']");
    expect(header).toContain("['/ai-stock-discovery', 'nav.discover']");
    expect(header).toContain("['/positions', 'nav.portfolio']");
    expect(header).toContain("['/how-it-works', 'nav.howItWorks']");
    expect(header).toContain("['/research-history', 'nav.researchHistory']");
    expect(header).toContain("['/decisions', 'nav.decisionLog']");
    expect(header).toContain("['/candidates', 'nav.candidateRecords']");
    expect(header).toContain("['/agentic-system', 'nav.portfolioReview']");
    expect(header).toContain("['/agent-settings', 'nav.agentSettings']");
    expect(header).toContain("['/account/security', 'nav.accountSecurity']");
    expect(i18n).toContain("'nav.investmentReview': 'Investment Review'");
    expect(i18n).toContain("'nav.portfolioReview': 'Portfolio Review'");
    expect(i18n).toContain("'nav.settings': 'Settings'");
    expect(i18n).toContain("'nav.thesis': '1. Thesis'");
    expect(i18n).toContain("'nav.discover': '2. Discover'");
    expect(i18n).toContain("'nav.portfolio': '3. Portfolio'");
    expect(portfolioWorkspaceNav).toContain("['/positions', 'Positions']");
    expect(portfolioWorkspaceNav).toContain("['/allocation', 'Allocation']");
    expect(portfolioWorkspaceNav).toContain("['/risk', 'Risk']");
    expect(portfolioWorkspaceNav).toContain("['/governance', 'Investment control']");
  });
});
