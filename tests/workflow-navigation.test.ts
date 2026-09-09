import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const setupPage = readFileSync('src/app/portfolio-setup/page.tsx', 'utf8');
const positionsPage = readFileSync('src/app/positions/page.tsx', 'utf8');
const header = readFileSync('src/components/header.tsx', 'utf8');

describe('discovery-first workflow', () => {
  it('does not make a position a prerequisite for discovery', () => {
    expect(setupPage).toContain("redirect('/positions#add-position')");
    expect(positionsPage).toContain('Approving a research candidate does not add a holding automatically.');
    expect(positionsPage).toContain('Record a holding');
  });

  it('puts the investment workflow, rather than internal tables, in primary navigation', () => {
    expect(header).toContain("['/investment-thesis', '1. Thesis']");
    expect(header).toContain("['/ai-stock-discovery', '2. Discover']");
    expect(header).toContain("['/positions', '3. Portfolio']");
    expect(header).toContain("['/how-it-works', 'How it works']");
    expect(header).toContain("['/risk', 'Portfolio risk']");
    expect(header).toContain("['/research-history', 'Research history']");
    expect(header).not.toContain("['/allocation', 'Allocation'],\n  ['/positions', 'Positions']");
  });
});
