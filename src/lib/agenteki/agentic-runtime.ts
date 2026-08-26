import { z } from 'zod';
import { GroundingBundle, ThesisCriteria, AnalysisOutput, AgentekiError } from './schemas';
import {
  ThesisInterpretation,
  EvidenceReview,
  FundamentalAssessment,
  RiskInterpretation,
  PortfolioFitAssessment,
  CriticAssessment,
  CommitteeDecision,
  AgenticTrace,
} from './agentic-schemas';
import { validateGrounding } from './pipeline';

const API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

type JsonSchema<T> = z.ZodType<T>;

async function runStructured<T>(
  name: string,
  system: string,
  input: unknown,
  schema: JsonSchema<T>,
  apiKey: string
): Promise<T> {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3500,
      system: `${system}\nReturn JSON only. Never calculate portfolio KPIs or financial ratios that were not explicitly supplied.`,
      messages: [{ role: 'user', content: JSON.stringify(input, null, 2) }],
    }),
  });
  if (!res.ok) throw new AgentekiError(`${name}: model API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n');
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a < 0 || b <= a) throw new AgentekiError(`${name}: no JSON object returned`);
    parsed = JSON.parse(cleaned.slice(a, b + 1));
  }
  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw new AgentekiError(`${name}: schema validation failed: ${validated.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  return validated.data;
}

export async function runAgenticAnalysis(args: {
  thesis: ThesisCriteria;
  bundle: GroundingBundle;
  apiKey: string;
}): Promise<AgenticTrace> {
  const { thesis, bundle, apiKey } = args;

  const thesisStep = await runStructured(
    'Thesis Interpreter',
    'You are the Thesis Interpreter. Select and explain the portfolio mandate relevant to this security. Do not invent criteria outside the supplied thesis.',
    { thesis, security: bundle },
    ThesisInterpretation,
    apiKey
  );

  const evidenceStep = await runStructured(
    'Research Evidence Agent',
    'You are the Research/Evidence Agent. Audit only the supplied evidence. Identify what is known, missing, stale, or conflicting. Do not infer unavailable facts and do not calculate new metrics.',
    { security: bundle, thesisInterpretation: thesisStep },
    EvidenceReview,
    apiKey
  );

  const fundamentalStep = await runStructured(
    'Fundamental Analyst',
    'You are the Fundamental Analyst. Assess quality, growth, dividends, balance sheet, profitability, competition, and reinvestment using only supplied fundamentals/evidence. Scores are qualitative judgments, not calculated financial ratios.',
    { security: bundle, thesisInterpretation: thesisStep, evidenceReview: evidenceStep },
    FundamentalAssessment,
    apiKey
  );

  const riskStep = await runStructured(
    'Risk Interpreter',
    'You are the Risk Interpreter. Interpret the supplied deterministic risk metrics. Never recompute, transform, annualize, interpolate, or replace any metric. If metrics are missing, state the gap.',
    { computedMetrics: bundle.computedMetrics, dataAsOf: bundle.dataAsOf, evidenceReview: evidenceStep },
    RiskInterpretation,
    apiKey
  );

  const fitStep = await runStructured(
    'Portfolio Fit Agent',
    'You are the Portfolio-Fit Agent. Decide which mandate the security fits and why. Do not size positions, allocate capital, or execute trades.',
    { thesisInterpretation: thesisStep, fundamentals: fundamentalStep, risk: riskStep, security: bundle },
    PortfolioFitAssessment,
    apiKey
  );

  const criticStep = await runStructured(
    'Critic Agent',
    'You are an adversarial investment critic. Build the strongest reasonable counter-case. Search for unsupported assumptions, data gaps, thesis breakers, and reasons the security should be rejected or deferred. Do not soften criticism to agree with prior agents.',
    { thesis: thesisStep, evidence: evidenceStep, fundamentals: fundamentalStep, risk: riskStep, portfolioFit: fitStep },
    CriticAssessment,
    apiKey
  );

  const committeeStep = await runStructured(
    'Investment Committee Synthesizer',
    'You are the Investment Committee Synthesizer. Produce the final structured analysis by reconciling the affirmative case with the critic. Human review remains final authority. criticIncorporated must be true only if the counter-case materially affects your synthesis. groundedIn must name only supplied deterministic metrics or fundamental keys.',
    {
      security: bundle,
      thesis: thesisStep,
      evidence: evidenceStep,
      fundamentals: fundamentalStep,
      risk: riskStep,
      portfolioFit: fitStep,
      critic: criticStep,
    },
    CommitteeDecision,
    apiKey
  );

  if (!committeeStep.criticIncorporated) {
    throw new AgentekiError('Investment Committee Synthesizer did not incorporate the critic output');
  }

  const finalAnalysis = AnalysisOutput.parse(committeeStep);
  validateGrounding(finalAnalysis, bundle);

  return {
    thesis: thesisStep,
    evidence: evidenceStep,
    fundamentals: fundamentalStep,
    risk: riskStep,
    portfolioFit: fitStep,
    critic: criticStep,
    committee: committeeStep,
  };
}
