import { describe, expect, it } from 'vitest';
import { researchStages, thesisPerspectives } from '../src/lib/research-workspace';

describe('research workspace truthfulness', () => {
  it('does not mark company research complete from approval alone', () => {
    const stages = researchStages({ runStatus: 'completed', decision: 'approved', workflowStatus: 'analysis_preparing',
      analysisRunStatus: 'queued', hasAnalysis: false, hasRisk: false });
    expect(stages.map((stage) => stage.state)).toEqual(['complete', 'complete', 'running', 'waiting']);
  });
  it('shows a failed analysis and no completed report', () => {
    const stages = researchStages({ runStatus: 'completed', decision: 'approved', workflowStatus: 'analysis_failed',
      analysisRunStatus: 'failed', hasAnalysis: false, hasRisk: true });
    expect(stages[2].state).toBe('failed');
    expect(stages[3].state).toBe('waiting');
  });
  it('does not invent a supporter or challenger when the analysis lacks labeled perspectives', () => {
    expect(thesisPerspectives('A positive thesis without the required labels')).toEqual({ affirmative: null, counter: null });
    expect(thesisPerspectives('Affirmative case: Revenue is growing. Strongest counter-case: Cash conversion is weak.'))
      .toEqual({ affirmative: 'Revenue is growing.', counter: 'Cash conversion is weak.' });
  });
});
