export type StageState = 'waiting' | 'running' | 'complete' | 'failed';

export interface ResearchStageInput {
  runStatus: string;
  decision: string;
  workflowStatus: string;
  analysisRunStatus: string | null;
  hasAnalysis: boolean;
  hasRisk: boolean;
}

/** Display only transitions backed by stored discovery and analysis states. */
export function researchStages(input: ResearchStageInput): Array<{ label: string; state: StageState }> {
  const discovery: StageState = input.runStatus === 'failed' ? 'failed'
    : input.runStatus === 'completed' ? 'complete'
      : input.runStatus === 'running' ? 'running' : 'waiting';
  const reviewed = input.decision === 'approved' || input.decision === 'rejected';
  const review: StageState = discovery !== 'complete' ? 'waiting' : reviewed ? 'complete' : 'running';
  const research: StageState = input.decision !== 'approved' ? 'waiting'
    : input.workflowStatus === 'analysis_failed' || input.analysisRunStatus === 'failed' ? 'failed'
      : input.hasAnalysis && input.hasRisk ? 'complete'
        : input.workflowStatus === 'analysis_preparing' || input.analysisRunStatus === 'running' ? 'running' : 'waiting';
  return [
    { label: 'Market research', state: discovery },
    { label: 'Human candidate review', state: review },
    { label: 'Company research and price risk', state: research },
    { label: 'Research summary available', state: input.decision === 'approved' && input.hasAnalysis ? 'complete' : 'waiting' },
  ];
}

/** These are sections of one sourced assessment, never independently executed agents. */
export function thesisPerspectives(thesis: string | null): { affirmative: string | null; counter: string | null } {
  if (!thesis) return { affirmative: null, counter: null };
  const match = thesis.match(/Affirmative case:\s*([\s\S]*?)\s*Strongest counter-case:\s*([\s\S]*)/i);
  return match ? { affirmative: match[1].trim() || null, counter: match[2].trim() || null }
    : { affirmative: null, counter: null };
}
