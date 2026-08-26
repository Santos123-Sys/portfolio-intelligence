# Master Specification Implementation

This document records how the uploaded Master Project Specification is being applied to `portfolio-intelligence`.

## Architectural invariants

1. AI interprets; deterministic TypeScript calculates.
2. Quantitative metrics are portfolio-scoped and currency-scoped.
3. Raw market observations and KPI history are persisted with provenance/methodology metadata.
4. Thesis versions are immutable references for AI analyses.
5. Human approval remains the final investment authority.
6. The database is the system of record; the dashboard does not reconstruct portfolio state.
7. External providers are accessed through replaceable connector interfaces.

## Existing implementation retained

The repository already implements substantial parts of the specification: PostgreSQL/Drizzle persistence, versioned thesis records, Agenteki structured output and grounding, deterministic returns/risk/weights modules, FX display conversion, provider abstraction, analysis jobs, risk-metric history, cron refresh/Agenteki workers, and a working Overview page.

## Current MVP build order

1. Database and portfolio state.
2. Deterministic weights/returns/risk engine.
3. Agenteki thesis interpretation and structured analysis.
4. Read-only management dashboard surfaces.
5. Real market-data provider after exchange coverage and fundamentals depth are verified.
6. Human review workflows and thesis upload/version management.

## Dashboard information architecture

- `/` — Overview
- `/investment-thesis` — thesis versions and criteria
- `/ai-stock-discovery` — AI analysis/discovery pipeline
- `/candidates` — human review queue
- `/portfolio` — positions and allocation
- `/risk-kpis` — methodology-aware risk metrics
- `/securities` — security universe and analysis status
- `/ai-insights` — AI interpretations and thesis risks

## Deliberate non-goals for this implementation stage

- Autonomous trade execution.
- Silent FX blending of portfolio risk/performance.
- LLM-generated numerical KPIs.
- Production authentication before the deployment security decision is made.
- Treating the current deterministic stub market provider as real financial data.

## Known gaps to resolve next

- Replace the stub market provider with a verified provider covering XSWX and BVMF and required fundamentals.
- Add complete market/fundamental provenance storage rather than only price history.
- Add Expected Shortfall, beta, covariance/correlation matrices and risk contribution to the persisted KPI pipeline.
- Complete thesis upload/version/re-analysis workflows.
- Add explicit candidate accept/reject/watchlist/re-analysis mutations.
- Add security-detail drill-down and historical KPI charts.
- Add authentication, authorization and production secrets controls before real portfolio data is deployed.
