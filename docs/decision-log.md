# Decision log

Append-only. Each entry: Decision · Reason · Alternatives considered · Trade-offs · Status.
Format follows the standard Architecture Decision Record (ADR) pattern — the same idea your original spec asked for in Section 22, in an established form.

Update this file as decisions get made or revisited. Don't delete superseded entries — mark them superseded and add a new one, so the history of *why* stays visible.

---

## ADR-001: Separate AI reasoning from deterministic calculation

**Decision:** Agenteki interprets and scores; it never calculates weights, returns, or risk metrics. All quantitative output comes from the quant engine, which Agenteki reads but does not write around.

**Reason:** This was your original design (Principle 1). Confirmed by independent research this session: LLMs are unreliable at exact arithmetic, and the credible fix across every source found — academic papers on financial agents, industry write-ups on LLM hallucination in finance, and how Addepar's own AI ("Addison") and Ghostfolio's MCP integration are actually built — is architectural separation with a read-only deterministic store, not better prompting.

**Alternatives considered:** Letting the AI do quick sanity-check math inline. Rejected — no clean line exists between "sanity check" and "the number the dashboard shows."

**Trade-offs:** More engineering upfront (a real quant engine, not just prompt text) in exchange for numbers you can trust.

**Status:** Accepted.

---

## ADR-002: Add an explicit FX / multi-currency layer

**Decision:** Add a base currency, an FX rate time series, and native-vs-base-currency reporting to the Performance and Risk Engines.

**Reason:** The thesis is explicitly bi-national (CHF Swiss equities, BRL Brazilian equities). The original spec's Performance and Risk Engine sections (10–12) never mention currency. Sharpe, VaR, and correlation all change meaningfully depending on which currency they're computed in. Both Ghostfolio and Kubera treat this as core infrastructure, not an add-on.

**Alternatives considered:** Reporting everything in native currency only. Rejected — defeats the purpose of a consolidated portfolio view across two countries.

**Trade-offs:** More schema complexity (an FXRate entity, a currency field on every monetary value) in exchange for risk numbers that mean what they claim to mean.

**Decided (revised):** Native currency per portfolio, no automatic blending. Sharpe/VaR/correlation are computed and reported in native currency only — CHF for the Swiss sleeve, BRL for the Brazilian sleeve. The FXRate entity stays in the schema (still needed for the transaction ledger and any single-security cross-currency comparisons) but is no longer used to produce a blended "official" performance or risk number.

**Open sub-question this creates:** Your original spec, Section 13, wants "Total portfolio value" as a headline figure on the Executive Overview. That figure cannot exist without converting at least one portfolio into the other's currency somewhere — which is the blending you just declined.

**Sub-question resolved:** Keep the total, but make the display currency user-selectable rather than fixed — a picker (CHF / BRL, expandable later) that converts the current total live for that one figure. This stays purely cosmetic: the conversion happens only in the display layer, using a current FX rate, and never feeds into Sharpe, VaR, drawdown, or any stored/calculated metric, which all remain native-currency per the main decision above. Needs a live FX rate source, separate from the equity data vendor question in ADR-005 — Portfolio Performance (researched this session) uses the European Central Bank's free daily reference rates for exactly this purpose; the ECB publishes BRL alongside CHF, USD, and most major currencies, which should be sufficient and doesn't require a paid subscription. Worth a direct check when this gets built, but it's a low-stakes implementation detail, not another architectural fork.

**Status:** Accepted (revised scope) — fully resolved, no open items.

---

## ADR-003: Split the original Phase 1 by adding a Phase 0

**Decision:** Before building Agenteki + database + dashboard together (original Phase 1), first prove position tracking and basic performance/weight math are correct against a manual/CSV baseline, with no AI involved.

**Reason:** De-risking. If Phase 1 ships and a number looks wrong, debugging is much harder when the AI layer, the database, and the dashboard were all built and are all suspects simultaneously.

**Alternatives considered:** Proceeding with the original single Phase 1. Not wrong, just riskier to debug.

**Trade-offs:** One more milestone before anything AI-related exists — for someone eager to get to Agenteki, this can feel like a detour.

**Status:** Superseded by ADR-007 below — you chose not to run this as a separate phase.

---

## ADR-004: Build vs. extend an existing open-source portfolio tracker

**Decision:** Build everything custom, as originally specced. No Ghostfolio, no Portfolio Performance as a substrate.

**Reason this is open:** Ghostfolio (self-hosted, AGPL-3.0) already solves position tracking, multi-currency, transaction history, and TWR/MWR — and now ships an MCP server an AI agent can query directly. It has no thesis-driven AI layer, which is the actually novel part of this project.

**Alternatives:**
(a) Build everything custom, as originally specced.
(b) Self-host Ghostfolio for Layers 2–3, build Agenteki as an MCP-connected AI layer on top.
(c) Portfolio Performance (desktop, Java) as the tracking substrate instead.

**Trade-offs:** (a) = full control, much more build time. (b) = months saved, less control over exact risk methodology (Ghostfolio's risk detection is currently simpler than full VaR/Sharpe). (c) = strong TWR/IRR, but desktop-only and less API-friendly than Ghostfolio for an AI layer to sit on top of.

**Consequence of (a), stated plainly so it isn't silently absorbed:** the transaction ledger, multi-currency conversion logic, and TWR/MWR calculation — all of which Ghostfolio provides for free — are now in your own build scope, on top of Agenteki. This is a legitimate choice (full control, no AGPL entanglement if this ever becomes more than personal use, no dependency on someone else's roadmap) — just naming the actual size of it once.

**Status:** Accepted.

---

## ADR-005: Market data vendor selection

**Decision:** EODHD, confirmed by measurement rather than by vendor claim — see the resolution below.

**Why this stayed open so long:** it needed SIX Swiss + B3 coverage *confirmed*, not advertised, and nobody had run the check. Two vendors listing an exchange on a pricing page is not the same as a key returning a price for it.

**Findings so far:** Twelve Data and EOD Historical Data both explicitly list SIX Swiss Exchange (XSWX) and B3/Bovespa (BVMF) as covered exchanges. IEX Cloud is not an option — shut down August 31, 2024. Fiscal.ai (already connected in your tools) has strong global fundamentals but unconfirmed SIX/B3 depth specifically.

**RESOLVED 2026-08-29 — EODHD, confirmed empirically.** `npm run verify:provider eodhd`, run in the production dashboard container against the live key, returned real closes dated 2026-08-28 on both required exchanges:

| Probe | Result |
|---|---|
| NESN (XSWX, Nestlé) | 78.62 CHF |
| WEGE3 (BVMF, WEG) | 49.98 BRL |
| PETR4 (BVMF, Petrobras) | 43.55 BRL |
| AAPL (XNAS, control) | 319.70 USD |
| ROG (XSWX, Roche) | no bar returned — see below |

This is the evidence the ADR was waiting for. Coverage of SIX Swiss and B3 was the open question, and it is answered: **EOD prices for both exchanges are available on the configured key.** The control probe passing is what makes the result trustworthy — it rules out a network or credential fault presenting as missing coverage.

**Two findings that came with it, neither reopening the vendor choice:**

- **Endpoints are entitled separately.** The same key that returned the prices above 403s on `/api/screener`, which `getSecurityUniverse` needs for stock discovery. That is a subscription question, not a code or vendor problem — EOD access does not imply Screener access. `describeEodhdFailure` in `eodhd.ts` now says so at the point of failure, because a bare "HTTP 403" cost a full debugging round-trip pointing at a key that was never broken.
- **ROG returned no bar** while NESN did, on the same exchange and the same request shape. Not a coverage failure — one working SIX probe settles the exchange — but an unexplained per-symbol gap worth understanding before the daily refresh depends on it. Most likely a ticker-mapping question (Roche's SIX listing) rather than absent data.

**Status:** Closed. EODHD is the market-data vendor. Screener entitlement is an open subscription item tracked separately, not a vendor decision.

**Addendum — how it got closed.** Two things made the question answerable:

- `StooqProvider` — free, no key, no signup, prices only. It is what works while a key is being arranged, and a second opinion when an EODHD result looks wrong. It cannot feed the DCF engine, which needs fundamentals.
- `npm run verify:provider [stooq|eodhd]` — fetches real SIX and B3 listings plus a US control and reports what came back. The EODHD path drives the real provider, so a pass confirms the provider as configured rather than the vendor's marketing claims. Its control probe is load-bearing: when the control also fails, the run reports INCONCLUSIVE rather than "not covered", because a bad key or a blocked network would otherwise read as a missing exchange and discard a working vendor on false evidence.

Stooq's own SIX/B3 coverage remains unconfirmed — the environment its connector was written in blocked `stooq.com` outright, and `STOOQ_SUFFIX` holds guesses rather than verified suffixes. That does not affect this decision: EODHD is the vendor, and Stooq stays a keyless second opinion whose suffixes should be verified the same way before anyone relies on it. See `docs/MARKET-DATA.md`.

The script was written so the next answer would be evidence instead of a third guess. It was run on 2026-08-29 and it was.

---

## ADR-006: Agent orchestration — hand-rolled pipeline vs. framework

**Decision:** Use hand-rolled orchestration (plain functions calling one OpenAI Responses API model with structured output at each stage) over LangGraph/CrewAI/AutoGen, because Agenteki is a fixed DAG rather than a dynamically branching multi-agent system.

**Reason:** Less infrastructure code, easier to debug, no framework lock-in, for a workflow that (per your own diagram) is linear.

**Alternatives considered:** LangGraph, CrewAI. Not wrong, just more machinery than a fixed pipeline currently needs. Worth revisiting if Agenteki's logic grows real conditional branching.

**Trade-offs:** Hand-rolled means more manual work if the pipeline later needs retries, parallel branches, or memory across runs — a framework would have given that for free.

**Status:** Proposed — low-stakes, easy to revisit later.

---

## ADR-007: Phase 1 internal build order (supersedes ADR-003)

**Decision:** No separate Phase 0. Instead, within Phase 1, build and validate the database schema and the quant engine's weight/return calculations against a manual baseline *first*, before wiring up Agenteki or the dashboard on top of them.

**Reason:** You declined a separate Phase 0 milestone. The underlying risk it was meant to catch is still real — if a number's wrong, you want to know it's wrong in the quant engine, not go hunting through three simultaneously-new layers to find out where. This gets the same debuggability without adding a phase boundary: same phase, ordered build.

**Alternatives considered:** Building all of Phase 1's pieces in parallel or in no particular order. Rejected for the reason above.

**Trade-offs:** None beyond ADR-003's original trade-off, just repackaged as sequencing within one phase instead of a phase of its own.

**Status:** Accepted.

---

## ADR-008: Host the system on Replit (supersedes the self-hosting recommendation)

**Decision:** Run development and production on Replit — workspace, database, deployments, secrets, and object storage all on-platform.

**Reason:** This is a personal project for now, and single-platform operation removes the deploy/host/configure overhead that would otherwise sit between writing code and using the system. Speed of iteration matters more at this stage than infrastructure control.

**What this supersedes:** The main architecture document recommends self-hosting over cloud SaaS, justified explicitly on the grounds that this is personal financial data. That reasoning is not wrong — it is being overridden as an accepted trade-off, not refuted. Logging it here so the reversal is visible rather than silent.

**Alternatives considered:** Railway (used previously on another project, purpose-built for this shape of deployment); a personal VPS. Both remain viable exits.

**Trade-offs:**
- Requires the Core plan (~$20/mo annual, ~$25 monthly) as a hard floor — the free Starter tier only permits public Repls, which would expose thesis criteria, scoring logic, and commit history.
- Total realistic run cost $25–30/month versus roughly $5/month for a minimal VPS.
- Credit-based billing makes cost less predictable than a fixed-price host.
- Financial data sits on shared infrastructure rather than a machine you control.

**Mitigation — portability discipline (binding):** standard PostgreSQL only, no Neon-specific features; configuration exclusively through `os.environ`; scheduled-job entry points written as plain scripts runnable off-platform. These keep migration to Railway or a VPS an afternoon's work rather than a rewrite.

**Status:** Accepted.

---

## ADR-009: Split into three Replit deployments

**Decision:** Run the system as three separate Replit deployments sharing one PostgreSQL database — (1) Autoscale for the FastAPI app and dashboard, (2) Scheduled for daily market-data refresh and quant-engine recompute, (3) Scheduled for Agenteki analysis runs.

**Reason:** Forced by the platform, then kept on merit. Autoscale deployments scale to zero when idle, so the in-process cron scheduler described in the main architecture cannot run. Replit's Scheduled Deployments are the correct substitute.

The forced split turns out to be an improvement: it enforces ADR-001's separation of AI reasoning from deterministic calculation at the infrastructure level rather than by convention. Three processes, three failure domains — an Agenteki crash cannot take down the dashboard or corrupt a quant run.

**Consequences:**
- Agenteki cannot run inside an HTTP request (unpredictable multi-minute LLM pipelines). Requires an async job pattern: endpoint writes a job row and returns immediately; scheduled deployment executes; dashboard polls. Add a `status` column to `AI_ANALYSIS`.
- Scheduled Deployments have no concurrency limit — overlapping runs are possible. The refresh job needs a Postgres advisory lock.
- Secrets do not inherit from workspace to deployment, and must be added separately for each of the three.
- Replit's filesystem resets on every deploy, so CSV imports must go straight into Postgres and generated artifacts (tearsheets, exports) into Object Storage.

**Trade-offs:** Three deployments cost more in base fees than one (~$2/mo each) and require secrets maintained in three places. Accepted in exchange for the isolation.

**Status:** Accepted.

---

## ADR-010: Move to a single Next.js/TypeScript application, superseding ADR-008 and ADR-009

**Decision:** Build the entire system as one Next.js/TypeScript application sourced from a GitHub repository, rather than a Python backend with a separate frontend. Postgres via Neon.

*Hosting was decided separately and has changed — see ADR-013 for the platform. This ADR is now only about the language and framework.*

**Reason:** The frontend was going to be generated as React/Next.js, so keeping a Python backend would have meant two platforms, two languages, and a CORS boundary — strictly worse than committing to one.

**Honest reassessment of the earlier analysis.** ADR-008 chose Replit partly on the conclusion that moving off it would force rebuilding the calculation layer. That conclusion was too strong, and two decisions already in this log are why:

- **ADR-006 already rejected CrewAI** in favour of hand-rolled orchestration. Agenteki was therefore never more than sequential LLM calls with structured output, which ports to TypeScript directly.
- **QuantStats and Riskfolio-Lib were a weaker dependency than they appeared.** Both return bare floats, while the explainability requirement demands methodology metadata on every metric — so each call was going to be wrapped regardless. Sharpe, volatility, drawdown, VaR, TWR and XIRR are roughly 150 lines of arithmetic, now implemented and covered by tests.

The rewrite cost was real but far smaller than "rebuild the calculation layer." And no Python was ever written — only specifications — so the reversal cost nothing but the decision itself.

**Unexpected benefit:** the `cvxpy` compilation risk flagged as a go/no-go for the entire risk engine is now moot. The quant engine has zero runtime dependencies.

**One trade-off outlived its original cause.** `job_locks` exists because Postgres advisory locks are session-scoped and were unusable under the connection churn of the original host. The TTL-based table is kept on Railway: at-least-once scheduling still has no concurrency guarantee, and two overlapping refresh runs writing FX rates is the same silent corruption it always was.

**Superseded:** ADR-008 (Replit hosting) and ADR-009 (three Replit deployments). `docs/superseded/replit-deployment-architecture.md` retains their reasoning. The original text of this ADR, written when the project deployed to a serverless host, is in `docs/superseded/original-hosting-adr-010.md`.

**Status:** Accepted and implemented as to language and framework. Hosting superseded by ADR-013.

---

## ADR-011: Zero-dependency quant engine

**Decision:** Implement all quantitative primitives directly rather than wrapping a library.

**Reason:** Three converging arguments. (1) The explainability requirement needs every metric to carry methodology, confidence level, horizon, lookback, and annualization factor — libraries return floats, so wrapping was unavoidable either way. (2) The formulas are genuinely simple and now have 32 tests against hand-checkable values. (3) It eliminates the `cvxpy` build risk entirely.

**Trade-off:** Portfolio optimization (Black-Litterman, risk parity, the 26 convex risk measures in Riskfolio-Lib) is not available. That was Phase 4 work and is not needed to run the system.

**Status:** Accepted.

---

## ADR-012: Reconcile the dashboard to the Master Build Specification's seven-page IA, keep the earlier IA reachable

**Decision:** When the project's Master Build Specification arrived as a build target in its own right, rebuild the primary navigation and the frontend page set to match its Section 5.3 exactly — `/`, `/allocation`, `/positions`, `/security/[ticker]`, `/intelligence`, `/risk`, `/decisions` — as client-only pages (`fetch()` in `useEffect`, no Server Components) per its Section 5.2. Do not delete the pages built under the earlier, close-but-not-identical IA (`/portfolio`, `/risk-kpis`, `/ai-insights`, `/securities`, `/investment-thesis`, `/ai-stock-discovery`, `/agentic-system`, `/candidates`); keep them reachable from the Header's "More" menu.

**Reason:** Section 10's success criteria checks for the seven named pages, so matching them exactly is not optional polish. But the earlier pages aren't redundant with the new ones — thesis upload, human-in-the-loop candidate decisions, and provenance browsing have no equivalent in the seven-page spec, and deleting working, tested functionality to satisfy a naming convention would be a worse outcome than carrying two navigation tiers for a while.

**Trade-off:** Two frontend architectures now coexist: the new pages are client-only per Section 5.2, the earlier ones are Server Components querying the database directly. That inconsistency is deliberate and temporary, not an oversight — it's tracked in `docs/MASTER-SPEC-IMPLEMENTATION.md`'s known gaps rather than hidden. `/api/positions`, `/api/analysis` and `/api/decision-log` gained fields and joins to support the new pages (day change, ticker joins, search) without changing any existing response field's meaning.

**Status:** Accepted.

---

## ADR-013: Railway is the hosting platform, superseding the hosting half of ADR-010

**Decision:** Host every service on Railway: the Next.js dashboard, the agentic API, and the agentic worker, each as its own Railway service, defined as config-as-code (`railway.dashboard.json`, `railway.agentic-api.json`, `railway.agentic-worker.json`) with `.railway/railway.ts` as the infrastructure definition. Postgres is a Railway service for the agentic database; the dashboard keeps its existing Neon connection. Scheduled work runs through `npm run cron:refresh`, not a platform cron product.

**Reason this ADR exists at all:** the platform changed and the log never recorded it. ADR-010 remained the standing hosting decision while the repository grew Railway configs, a Railway IaC definition, `docs/RAILWAY-DEPLOYMENT.md`, and a Railway-shaped cron entry point. A decision log that disagrees with the repository is worse than no log, because it is read as current.

**What Railway gives this system that the previous platform did not:**
- **No serverless execution ceiling.** The agentic worker runs as a long-lived process, so a run is bounded by cost and blast radius rather than by a function timeout. This is why the analysis worker's job bound is a deliberate choice now instead of a workaround.
- **A separate worker service.** The API and the worker scale and fail independently; a stuck job cannot take the dashboard down with it.
- **Migrations as a deploy step.** `preDeployCommand` runs `db:migrate` before a new version takes traffic, so schema and code ship together instead of needing a manual step.

**Trade-offs accepted:**
- Services are always-on rather than scale-to-zero, so idle cost is non-zero where a serverless platform's was not.
- Variables are scoped per service. The dashboard having a key says nothing about the worker having it, which is a real and repeated source of misconfiguration — `docs/RAILWAY-DEPLOYMENT.md` carries the per-service matrix for that reason.
- Preview environments are not automatic the way a Git-integrated serverless platform's are.

**Consequence for the docs:** the previous platform is removed from all live guidance and configuration. `docs/superseded/` retains the historical evaluations, including `platform-comparison.md`, because deleting the reasoning behind a superseded decision is how a project relitigates it a year later.

**Status:** Accepted, implemented.

---
