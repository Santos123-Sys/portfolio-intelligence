/**
 * Agenteki — the AI reasoning layer.
 *
 * ADR-006: hand-rolled, not a framework. The workflow is a fixed sequence
 * (ground -> analyze -> validate -> persist), not a dynamically branching
 * multi-agent negotiation, and a fixed sequence written as plain functions is
 * more debuggable than the same sequence expressed through an orchestrator.
 *
 * ADR-001 is enforced twice here, because a prompt instruction alone is not
 * enforcement:
 *   1. The prompt forbids arithmetic and supplies pre-computed values.
 *   2. `validateGrounding` rejects any output whose groundedIn references a
 *      metric that was not actually in the bundle — i.e. it catches the model
 *      inventing a number it claims to have used.
 */

import {
  AnalysisOutput,
  AgentekiError,
  GroundingBundle,
  ThesisCriteria,
} from './schemas';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

function buildSystemPrompt(thesis: ThesisCriteria): string {
  return `You are Agenteki, an investment analysis component inside a larger system.

ABSOLUTE CONSTRAINTS — these are architectural, not stylistic:

1. You must NEVER calculate a quantitative metric. Not a weight, not a return,
   not a volatility, not a Sharpe ratio, not a VaR figure. Not as a check, not
   "approximately", not once. All such values are supplied to you pre-computed
   by a deterministic engine. If a number you need is absent from the supplied
   data, list it under informationGaps. Do not estimate it.

2. Every claim you make must trace to a supplied value. The groundedIn array
   must list the exact metric names you relied on, spelled as they appear in the
   input. Listing a metric you were not given is a validation failure.

3. Never present a hypothesis as an established fact. Hedged reasoning stated
   plainly is correct; false confidence is not.

4. State genuine uncertainty in confidenceScore. A low score on thin data is the
   right answer, not a failure.

INVESTMENT THESIS (version ${thesis.version}) — score strictly against this:
${JSON.stringify(thesis, null, 2)}

Return ONLY a JSON object matching the required schema. No preamble, no
markdown fences, no commentary before or after the JSON.`;
}

function buildUserPrompt(bundle: GroundingBundle): string {
  return `Analyze this security against the thesis.

SECURITY
  Ticker:     ${bundle.ticker}
  Name:       ${bundle.companyName}
  Exchange:   ${bundle.exchange}
  Currency:   ${bundle.currency}
  Sector:     ${bundle.sector ?? 'unknown'}
  Country:    ${bundle.country ?? 'unknown'}

PRE-COMPUTED METRICS (deterministic engine, as of ${bundle.dataAsOf})
${
  Object.keys(bundle.computedMetrics).length === 0
    ? '  (none available — say so in informationGaps and lower confidenceScore accordingly)'
    : Object.entries(bundle.computedMetrics)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n')
}

FUNDAMENTALS
${
  Object.keys(bundle.fundamentals).length === 0
    ? '  (none available)'
    : Object.entries(bundle.fundamentals)
        .map(([k, v]) => `  ${k}: ${v ?? 'n/a'}`)
        .join('\n')
}

Use only the values above. Reference the exact metric names in groundedIn.`;
}

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new AgentekiError('Model returned no parseable JSON object');
    }
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch (e) {
      throw new AgentekiError('Model returned malformed JSON', e);
    }
  }
}

/**
 * Rejects grounding references that do not correspond to supplied data.
 *
 * This is the check that catches the specific failure this architecture was
 * built to prevent: a fluent, plausible analysis citing a Sharpe ratio that was
 * never computed. Prompt instructions reduce that; they do not eliminate it.
 */
export function validateGrounding(
  output: AnalysisOutput,
  bundle: GroundingBundle
): void {
  const available = new Set([
    ...Object.keys(bundle.computedMetrics),
    ...Object.keys(bundle.fundamentals),
  ]);
  if (available.size === 0) return; // Nothing supplied; nothing to contradict.

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const availableNorm = new Set([...available].map(normalize));

  const fabricated = output.groundedIn.filter((ref) => {
    const n = normalize(ref);
    return ![...availableNorm].some((a) => n.includes(a) || a.includes(n));
  });

  if (fabricated.length > 0) {
    throw new AgentekiError(
      `Grounding validation failed. The analysis cites data it was not given: ` +
        `${fabricated.join(', ')}. Available: ${[...available].join(', ')}`
    );
  }
}

export async function analyzeSecurity(
  bundle: GroundingBundle,
  thesis: ThesisCriteria,
  apiKey: string
): Promise<AnalysisOutput> {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: buildSystemPrompt(thesis),
      messages: [{ role: 'user', content: buildUserPrompt(bundle) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AgentekiError(`Anthropic API ${res.status}: ${body.slice(0, 400)}`);
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n');

  const parsed = AnalysisOutput.safeParse(extractJson(text));
  if (!parsed.success) {
    throw new AgentekiError(
      `Output failed schema validation: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`
    );
  }

  validateGrounding(parsed.data, bundle);
  return parsed.data;
}

/**
 * Diff two analyses of the same security so a changed recommendation renders as
 * a visible delta rather than a silent overwrite.
 */
export function diffAnalyses(
  prev: AnalysisOutput,
  next: AnalysisOutput
): { field: string; from: unknown; to: unknown }[] {
  const watched: (keyof AnalysisOutput)[] = [
    'portfolioCandidate',
    'portfolioRole',
    'investmentScore',
    'thesisAlignmentScore',
    'qualityScore',
    'growthScore',
    'riskScore',
    'dividendScore',
    'confidenceScore',
  ];
  return watched
    .filter((f) => prev[f] !== next[f])
    .map((f) => ({ field: f as string, from: prev[f], to: next[f] }));
}
