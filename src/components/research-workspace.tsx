'use client';

import { researchStages, thesisPerspectives, type ResearchStageInput } from '@/lib/research-workspace';

interface WorkspaceCandidate extends Omit<ResearchStageInput, 'hasAnalysis' | 'hasRisk'> {
  companyName: string;
  risk: Array<{ metricName: string; value: number }> | null;
  analysis: {
    fundamentalSummary: string | null;
    investmentThesis: string | null;
    keyRisks: string[] | null;
    informationGaps: string[] | null;
    researchFramework: { marketContext: string[] } | null;
    groundedIn: string[] | null;
  } | null;
  sourceUrls: string[];
}

export function ResearchWorkspace({ candidate, onOpenReport }: {
  candidate: WorkspaceCandidate;
  onOpenReport: () => void;
}) {
  const stages = researchStages({ ...candidate, hasAnalysis: !!candidate.analysis, hasRisk: !!candidate.risk?.length });
  const perspectives = thesisPerspectives(candidate.analysis?.investmentThesis ?? null);
  const evidenceCount = candidate.analysis?.groundedIn?.length ?? 0;
  const cards = [
    { title: 'Market context', detail: candidate.analysis?.researchFramework?.marketContext.join(' · ') || null },
    { title: 'Financial evidence', detail: candidate.analysis?.fundamentalSummary ?? null },
    { title: 'Price risk', detail: candidate.risk?.length
      ? candidate.risk.slice(0, 2).map((metric) => `${metric.metricName.replaceAll('_', ' ')}: ${(metric.value * 100).toFixed(2)}%`).join(' · ') : null },
    { title: 'Affirmative case', detail: perspectives.affirmative },
    { title: 'Strongest counter-case', detail: perspectives.counter },
    { title: 'Open questions', detail: candidate.analysis?.informationGaps?.join(' · ') || candidate.analysis?.keyRisks?.join(' · ') || null },
  ];

  return <section className="research-workspace" aria-label={`Research workspace for ${candidate.companyName}`}>
    <div className="research-workspace-heading">
      <div><p className="analysis-eyebrow">Research workspace</p><h4>Evidence and decision path</h4></div>
      {candidate.analysis && <button className="secondary-button" type="button" onClick={onOpenReport}>Open embedded financial report</button>}
    </div>
    <p className="note">These cards organize one source-backed assessment. They do not represent separate agents or independent votes.</p>
    <div className="research-workspace-layout">
      <div className="research-perspectives">
        <h5>Analysis perspectives</h5>
        <div className="research-perspective-grid">
          {cards.map((card) => <article className="research-perspective" key={card.title}>
            <h6>{card.title}</h6>
            <p>{card.detail ?? 'Pending source-backed analysis.'}</p>
          </article>)}
        </div>
        <p className="note">{evidenceCount} retained analysis references · {candidate.sourceUrls.length} discovery source links. Review the evidence and limitations below.</p>
      </div>
      <div className="research-workflow">
        <h5>Research workflow</h5>
        <ol aria-label="Recorded research stages" aria-live="polite">
          {stages.map((stage) => <li className={`research-workflow-${stage.state}`} key={stage.label}>
            <span className="research-workflow-dot" aria-hidden="true" />
            <span>{stage.label}</span><strong>{stage.state}</strong>
          </li>)}
        </ol>
        <p className="note">Status reflects saved research and review records. Financial figures appear in the report only when sourced.</p>
      </div>
    </div>
  </section>;
}
