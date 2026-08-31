import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const setupPage = readFileSync('src/app/portfolio-setup/page.tsx', 'utf8');
const header = readFileSync('src/components/header.tsx', 'utf8');

describe('discovery-first workflow', () => {
  it('does not make a position a prerequisite for discovery', () => {
    expect(setupPage).toContain('Positions are not required for market research.');
    expect(setupPage).toContain('Do not add a position at this stage.');
    expect(setupPage).not.toContain('Add at least one position.</li>');
    expect(setupPage).not.toContain('Add a position to {portfolio.name}.');
  });

  it('puts the investment workflow, rather than internal tables, in primary navigation', () => {
    expect(header).toContain("['/investment-thesis', '1. Thesis']");
    expect(header).toContain("['/ai-stock-discovery', '2. Discover']");
    expect(header).toContain("['/positions', '3. Portfolio']");
    expect(header).toContain("['/risk', 'Monitor']");
    expect(header).not.toContain("['/allocation', 'Allocation'],\n  ['/positions', 'Positions']");
  });
});
