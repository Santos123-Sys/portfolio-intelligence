import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const candidateRoute = readFileSync('src/app/api/discovery/candidates/route.ts', 'utf8');
const discoveryPage = readFileSync('src/app/ai-stock-discovery/page.tsx', 'utf8');
const positionsPage = readFileSync('src/app/positions/page.tsx', 'utf8');
const positionsRoute = readFileSync('src/app/api/positions/route.ts', 'utf8');
const recompute = readFileSync('src/lib/services/recompute.ts', 'utf8');

describe('run-scoped candidate review', () => {
  it('requires a run id and constrains the candidate query to that run', () => {
    expect(candidateRoute).toContain("searchParams.get('runId')");
    expect(candidateRoute).toContain("error: 'A valid discovery runId is required'");
    expect(candidateRoute).toContain('eq(discoveryCandidates.runId, parsedRunId.data)');
    expect(candidateRoute).toContain("ne(discoveryCandidates.decision, 'rejected')");
  });

  it('loads candidates only after the user chooses a specific discovery run', () => {
    expect(discoveryPage).toContain('const [selectedRunId, setSelectedRunId] = useState<string | null>(null)');
    expect(discoveryPage).toContain('/api/discovery/candidates?runId=');
    expect(discoveryPage).toContain('Review latest candidates');
    expect(discoveryPage).toContain('Candidate results are hidden.');
  });

  it('keeps only the latest run in the active workflow and moves history to its own folder', () => {
    expect(discoveryPage).toContain('Latest market research');
    expect(discoveryPage).toContain('href="/research-history"');
    expect(discoveryPage).not.toContain('Show run history');
    expect(discoveryPage).toContain('setSelectedRunId(null)');
  });
});

describe('positions empty-state behavior', () => {
  it('distinguishes no recorded holdings from a filter with no matches', () => {
    expect(positionsPage).toContain('No positions have been recorded. Approving a research candidate does not add a holding automatically.');
    expect(positionsPage).toContain('No positions match the current filters.');
    expect(positionsPage).toContain('onClick={resetFilters}');
    expect(positionsPage).toContain('href="/portfolio-setup#add-position"');
  });

  it('keeps position reads and writes owner-scoped and rejects duplicates', () => {
    expect(positionsRoute).toContain('eq(portfolios.ownerId, session.auth.userId)');
    expect(positionsRoute).toContain("throw new PositionSetupError('Portfolio not found', 404)");
    expect(positionsRoute).toContain("throw new PositionSetupError('This security already has a position in the selected portfolio', 409)");
  });

  it('shows the latest research queue separately from owned positions', () => {
    expect(positionsPage).toContain('Latest research candidates');
    expect(positionsPage).toContain('Candidates are opportunities for review, not portfolio holdings.');
    expect(positionsPage).toContain("fetch('/api/portfolio/research')");
  });

  it('derives position values and weights from refreshed market prices', () => {
    expect(recompute).toContain('export async function recomputePositionValues');
    expect(recompute).toContain('export async function recomputeWeights');
    expect(recompute).toContain('const mv = Number(r.quantity) * Number(latest.close)');
  });
});
