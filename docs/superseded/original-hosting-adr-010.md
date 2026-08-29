> **SUPERSEDED by ADR-013.** The platform is Railway. This is the original
> ADR-010 exactly as written when the project deployed to Vercel, kept because
> a decision log that quietly rewrites its own past cannot be trusted about
> its present. The parts of it that still hold — the move to a single
> Next.js/TypeScript application, and the reassessment of the Python stack —
> remain live in `docs/decision-log.md` under ADR-010. Nothing here is
> guidance.

# ADR-010 as originally written (previous hosting platform)

## ADR-010: Move to a single Next.js app, superseding ADR-008 and ADR-009 (hosting superseded by ADR-013)

**Decision:** Build and deploy the entire system as a single Next.js/TypeScript application on Vercel, sourced from a GitHub repository. Postgres via Neon/Vercel Postgres. Scheduled work via Vercel Cron.

**Reason:** You chose to deploy through v0/Vercel from a GitHub repo. Since v0 generates React/Next.js and Vercel is TypeScript-first, keeping a Python backend would have meant two platforms, two languages, and a CORS boundary — strictly worse than committing to one.

**Honest reassessment of the earlier analysis.** ADR-008 chose Replit partly on my own conclusion that Vercel would force rebuilding the calculation layer. That conclusion was too strong, and two decisions already in this log are why:

- **ADR-006 already rejected CrewAI** in favour of hand-rolled orchestration. Agenteki was therefore never more than sequential LLM calls with structured output, which ports to TypeScript directly.
- **QuantStats and Riskfolio-Lib were a weaker dependency than they appeared.** Both return bare floats, while the explainability requirement demands methodology metadata on every metric — so each call was going to be wrapped regardless. Sharpe, volatility, drawdown, VaR, TWR and XIRR are roughly 150 lines of arithmetic, now implemented and covered by 32 tests.

The rewrite cost was real but far smaller than "rebuild the calculation layer." And no Python was ever written — only specifications — so the reversal cost nothing but the decision itself.

**Unexpected benefit:** the `cvxpy` compilation risk flagged as a go/no-go for the entire risk engine is now moot. The quant engine has zero runtime dependencies.

**Trade-offs accepted:**
- Serverless function time limits are a harder ceiling than Replit's 11-hour Scheduled Deployments. Mitigated by bounding the Agenteki worker to 3 jobs per invocation.
- Vercel Hobby is restricted to personal, non-commercial use by ToS. This project qualifies; that stops being true if it ever advises anyone else — which is the same boundary flagged for Phase 4 under the Investment Advisers Act.
- Postgres advisory locks are unusable under serverless connection churn; replaced with a TTL-based `job_locks` table.
- Cron frequency is limited on Hobby. Verify the current allowance.

**Superseded:** ADR-008 (Replit hosting) and ADR-009 (three Replit deployments). `docs/superseded/replit-deployment-architecture.md` is retained for the reasoning, not as live guidance.

**Status:** The move to a single Next.js/TypeScript application is accepted and implemented, and everything above about the language and framework choice still holds. **The hosting half of this decision is superseded by ADR-013 — the platform is Railway.** The serverless trade-offs listed above are historical and no longer constrain the system; they are kept because they explain why `job_locks` exists and why the Agenteki worker is bounded.

---
