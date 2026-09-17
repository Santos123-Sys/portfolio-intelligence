import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const securityDetail = readFileSync('src/app/security/[ticker]/page.tsx', 'utf8');
const candidateRoute = readFileSync('src/app/api/candidates/route.ts', 'utf8');

describe('analysis explainability UX', () => {
  it('renders confidence, thesis-gate, evidence and explicit-gap states in the analysis itself', () => {
    expect(securityDetail).toContain('Thin data');
    expect(securityDetail).toContain('Thesis-fit gate active');
    expect(securityDetail).toContain('Information still missing');
    expect(securityDetail).toContain('evidence-chips');
  });

  it('links one immutable PDF snapshot to the selected live analysis version', () => {
    expect(securityDetail).toContain('Open PDF snapshot');
    expect(securityDetail).toContain('Open this live analysis');
    expect(securityDetail).toContain('externalRunId');
  });

  it('records human verdicts in both the workflow record and append-only decision log', () => {
    expect(securityDetail).toContain('Human review');
    expect(candidateRoute).toContain('candidateDecisions');
    expect(candidateRoute).toContain('tx.insert(decisionLog)');
  });
});
