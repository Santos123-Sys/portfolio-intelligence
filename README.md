# Portfolio Intelligence

AI-assisted investment management for two equity portfolios and a fixed-income sleeve, built on a deterministic quantitative engine.

**Stack:** Next.js 15 · TypeScript · Drizzle ORM · Postgres (Neon/Vercel) · Vercel
**Tests:** 51 passing across the quant engine, FX layer, and Agenteki guards.

---

## The one principle everything else follows

**The AI never calculates. The calculation engine never interprets.**

Every number is produced by deterministic TypeScript in `src/lib/quant/` and stored in Postgres. Agenteki reads those values as grounding, writes structured interpretation back, and is never permitted to compute a weight, return, Sharpe ratio, or VaR figure.

This is enforced in three places, not just asked for in a prompt:

1. `src/lib/quant/` imports nothing from `src/lib/agenteki/` or `src/lib/fx/`.
2. `validateGrounding()` rejects any analysis citing a metric that was not supplied — catching the specific failure mode of a fluent, plausible analysis referencing a Sharpe ratio nobody computed.
3. The output schema requires a non-empty `groundedIn` array. An analysis grounded in nothing is an opinion, and opinions are not stored as analysis.

---

## The currency rule (ADR-002)

Risk and performance are computed **per portfolio, in native currency**, and never blended. A CHF Sharpe and a BRL Sharpe do not combine into one number.

`assertSingleCurrency()` throws if asked to weight positions across currencies. Not because the result would be wrong, but because it would be *meaningless* — and plausible-looking meaningless numbers are exactly what this architecture exists to prevent.

The sole exception is the display total on the Overview page: converted live at ECB reference rates, rendered with its disclaimer, never persisted, never feeding another figure. It lives alone in `src/lib/fx/displayTotal()` so the rule stays enforceable by inspection.

---

## Setup

```bash
npm install
cp .env.example .env.local        # fill in DATABASE_URL
npm run db:push                   # create tables
npm run seed                      # 2 portfolios, 6 securities, 400 days of prices
npm run dev
```

Then trigger a first computation:

```bash
curl http://localhost:3000/api/cron/refresh
```

Run the tests:

```bash
npm test
```

---

## Deploying to Vercel

1. Push to GitHub.
2. Import the repo at vercel.com → **New Project**.
3. Add a Postgres database: **Storage → Create → Postgres** (or connect Neon). `DATABASE_URL` is injected automatically.
4. Add environment variables under **Settings → Environment Variables**:
   - `ANTHROPIC_API_KEY` — Agenteki returns 503 without it; everything else still runs
   - `CRON_SECRET` — a long random string; without it `/api/cron/*` is publicly callable
   - `MARKET_DATA_PROVIDER` — `stub` until ADR-005 is resolved
5. Deploy. `vercel.json` registers both cron jobs automatically.
6. Run `npm run db:push` against the production `DATABASE_URL` once.

> **Vercel scopes environment variables per environment.** A variable set on Production is invisible to Preview. `src/lib/env.ts` fails at startup naming the missing key rather than surfacing an `undefined` three layers deep.

### Cron schedule

| Job | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/cron/refresh` | `0 21 * * 1-5` | Prices → FX → recompute all metrics |
| `/api/cron/agenteki` | `0 22 * * 1-5` | Drain the analysis queue |

21:00 UTC sits after both SIX Swiss and B3 close. **Vercel's Hobby tier limits cron frequency** — verify the current allowance for your plan; the schedules may need widening.

---

## Layout

```
src/lib/quant/       Deterministic engine. No LLM calls. 32 tests.
  types.ts           RiskMetric — every metric carries its full methodology
  returns.ts         Simple, TWR (sub-period linked), MWR (bisection XIRR)
  risk.ts            Volatility, Sharpe, drawdown, VaR (historical + parametric)
  weights.ts         Position/sector/country weights, HHI, currency guard

src/lib/fx/          The ONLY place currencies mix. ECB rates + displayTotal().
src/lib/agenteki/    Structured output schema + hand-rolled pipeline (ADR-006)
src/lib/connectors/  PriceProvider interface + deterministic stub (ADR-005 open)
src/lib/services/    Recompute chain, distributed job lock
src/lib/db/          Drizzle schema — 12 tables
src/app/api/         Route handlers, including two cron workers
tests/               51 tests, all against hand-checkable values
```

---

## Design decisions worth knowing before you edit

**Why no QuantStats or Riskfolio-Lib.** The original architecture recommended them. Two things changed that: the move to TypeScript removed them as options, and the explainability requirement made them a poor fit anyway — they return bare floats, so every call would have been wrapped to attach methodology metadata. The primitives are ~150 lines of arithmetic and are fully tested here. A useful side effect: the `cvxpy` compilation risk that hung over the Python design is simply gone.

**Why bisection instead of Newton-Raphson for XIRR.** Newton converges faster but can diverge on irregular cash-flow patterns — which is precisely what a real portfolio produces. Bisection cannot fail to converge inside its bracket. Slower, and the right trade for a number a human will act on.

**Why a `job_locks` table instead of `pg_try_advisory_lock`.** Advisory locks are session-scoped and release when the connection closes. Serverless connections close constantly, often mid-job. A row with an explicit TTL survives that.

**Why `analysis_jobs` is separate from `ai_analyses`.** The architecture called for a `status` column on the analyses table. A job can fail, retry, or be cancelled without ever producing an analysis; merging the two conflates "what the AI concluded" with "whether the AI ran." A failed run now leaves a diagnosable record rather than a half-populated result row.

**Why the Agenteki worker processes only 3 jobs per invocation.** Serverless functions have a wall-clock ceiling. An unbounded queue drain gets killed mid-job, stranding rows in `running`. A small batch finishes cleanly and the next tick picks up the rest.

---

## What is NOT finished

Stated plainly, because a spec that overstates completeness is worse than no spec.

- **No real market data.** `StubProvider` generates a reproducible pseudo-random walk seeded from the ticker. Every row is tagged `source: 'stub'`. ADR-005 is open — Twelve Data and EODHD both list XSWX and BVMF, but fundamentals depth for those two exchanges specifically is unverified.
- **Risk-free rates are hardcoded** in `recompute.ts`. Sharpe is directionally useful and not yet trustworthy in absolute terms.
- **TWR ignores cash flows.** The function supports them; the recompute service doesn't yet pass transactions in. Until it does, TWR equals cumulative return. The metric carries a caveat saying so.
- **Only the Overview page is built.** Pages 2–7 from `V0-DASHBOARD-BRIEF.md` are not. That is deliberate — v0 generates them against the API contract the Overview page establishes.
- **No authentication.** Single-user, but a deployed Vercel URL is public. Add Vercel Password Protection or an auth layer before putting real holdings in.
- **Agenteki has never run against the live API.** The schema validation and grounding guard are tested; the end-to-end call with a real key is not.

---

## Documents

| File | Contents |
|---|---|
| `docs/decision-log.md` | ADR-001 → ADR-011, full reasoning and trade-offs |
| `docs/architecture.md` | Components, data flow, dashboard IA, phasing |
| `docs/V0-DASHBOARD-BRIEF.md` | **Paste this into v0** — frontend spec only |
| `docs/platform-comparison.md` | base44 / Replit / Vercel / Manus / Kimi evaluation |
| `docs/superseded/` | The Python/Replit design, retained for its reasoning. Not live guidance. |
| `CONTRIBUTING.md` | The architectural invariants that must not be broken |
