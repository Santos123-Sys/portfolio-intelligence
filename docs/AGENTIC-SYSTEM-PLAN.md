# Agentic Investment System — Implementation Plan

## Objective

Turn Agenteki from a single analysis call into a coordinated, auditable investment-intelligence system integrated with the existing thesis, market-data, quant, database, API and dashboard layers.

## Non-negotiable boundaries

1. Agents interpret; deterministic software calculates.
2. Agents may only use supplied/retrieved evidence and persisted quant metrics.
3. The database remains the system of record.
4. Every agent step is structured and auditable.
5. A critic agent must challenge the affirmative case before synthesis.
6. Human review remains the final decision authority.
7. No trade execution is permitted.

## Agent graph

```text
Investment Thesis
      ↓
Orchestrator
      ↓
Thesis Interpreter
      ↓
Research / Evidence Agent
      ↓
Fundamental Analyst
      ↓
Risk Interpreter ← deterministic KPI engine
      ↓
Portfolio-Fit Agent
      ↓
Critic / Red-Team Agent
      ↓
Investment Committee Synthesizer
      ↓
Structured Analysis Record
      ↓
Human Review
```

## Agent responsibilities

### 1. Thesis Interpreter
Converts the active thesis into the mandate and criteria relevant to the security under review. It does not invent new policy.

### 2. Research / Evidence Agent
Organizes retrieved market/fundamental evidence, identifies missing information, source conflicts and stale observations. It does not calculate KPIs.

### 3. Fundamental Analyst
Assesses business quality, growth, profitability, balance-sheet strength, dividend characteristics, competitive position and reinvestment potential using supplied evidence.

### 4. Risk Interpreter
Interprets deterministic risk metrics such as volatility, Sharpe, VaR, Expected Shortfall and drawdown. It cannot recompute or alter them.

### 5. Portfolio-Fit Agent
Assesses whether the security belongs in Swiss Quality, Brazilian Growth, Fixed Income, or is not suitable. It evaluates role and thesis alignment, not trade sizing.

### 6. Critic / Red-Team Agent
Builds the strongest counter-case, identifies unsupported assumptions, missing data, thesis breakers, concentration concerns and reasons to reject or defer.

### 7. Investment Committee Synthesizer
Consumes all prior structured outputs and produces the final structured Agenteki analysis. It must explicitly incorporate the critic output and disclose information gaps.

## Execution model

- One analysis job represents one security/thesis-version evaluation.
- The orchestrator executes agents in a bounded workflow suitable for a Vercel function.
- Each step returns JSON validated by Zod.
- Failed validation fails the job explicitly.
- The final output maps to the existing `ai_analyses` schema so existing dashboard/API surfaces remain compatible.
- Agent run/step metadata is persisted for auditability.

## Market-data integration

The Research Agent receives evidence from the market-data connector. For Yahoo Finance, the approved design is search-mediated ingestion rather than direct scraping: a web-search service queries Yahoo Finance pages and returns snippets/source URLs. Latest observations are persisted with provenance. Historical KPI calculations use persisted observations accumulated over time; insufficient history returns `DATA_INSUFFICIENT` rather than fabricated backfill.

## Implementation sequence

1. Add agentic contracts and generic structured LLM runner.
2. Add orchestrator implementing the seven-agent graph.
3. Persist agent run and step audit records.
4. Replace the single Agenteki call in the worker with the orchestrator.
5. Add API access to agent run traces.
6. Add an Agentic System dashboard page.
7. Add Yahoo web-search connector and provenance persistence.
8. Validate typecheck/tests/build and deploy preview.

## Completion definition

The agentic system is considered operational when a queued security analysis can traverse all seven agents, persist a validated final analysis and trace, and appear in the existing Candidates/AI Insights surfaces without allowing any agent to become a numerical source of truth or execute a trade.
