import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const route = readFileSync('src/app/api/discovery/candidates/route.ts', 'utf8');
const workflow = readFileSync('src/lib/discovery-workflow.ts', 'utf8');
const page = readFileSync('src/app/ai-stock-discovery/page.tsx', 'utf8');
const schema = readFileSync('src/lib/db/workflow-schema.ts', 'utf8');

describe('candidate approval to analysis workflow', () => {
  it('persists approval before slow provider work continues after the response', () => {
    expect(route).toContain("import { after, NextResponse } from 'next/server'");
    expect(route.indexOf('await approveCandidateForAnalysis(')).toBeLessThan(route.indexOf('after(async () =>'));
    expect(route).toContain('await startApprovedCandidateAnalysis(');
    expect(workflow).toContain("workflowStatus: 'analysis_preparing'");
  });

  it('persists preparation failures and retains a retry path', () => {
    expect(schema).toContain("analysisErrorMessage: text('analysis_error_message')");
    expect(route).toContain('await failCandidateAnalysisPreparation(');
    expect(workflow).toContain("workflowStatus: 'analysis_failed'");
    expect(page).toContain('Retry analysis preparation');
  });

  it('uses only approved-candidate price history and explicit research evidence', () => {
    expect(workflow).toContain('provider.getDailyBars(');
    expect(workflow).toContain("analysisMode: 'limited_research_risk'");
    expect(workflow).toContain('researchEvidence,');
    expect(workflow).toContain('fundamentals: {},');
    expect(workflow).not.toContain('getFundamentals(');
    expect(workflow).not.toContain('loadFundamentalsWithFallback');
  });

  it('keeps the candidate card updated while preparation is active', () => {
    expect(page).toContain("candidate.workflowStatus === 'analysis_preparing'");
    expect(page).toContain('Approval saved. Retrieving validated price history');
    expect(page).toContain('candidateErrors[candidate.id]');
  });
});
