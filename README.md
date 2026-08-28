# Portfolio Intelligence

AI-assisted investment management for two equity portfolios and a fixed-income sleeve, built on a deterministic quantitative engine.

**Stack:** Next.js 16 · TypeScript · Drizzle ORM · PostgreSQL · Railway

The repository is now one npm-workspace system. The Next.js service owns the
dashboard, deterministic portfolio calculations, authentication and persistence;
the private agentic API/worker services own thesis extraction, security reasoning,
synthesis and PDF generation. All language-model stages use one configurable
OpenAI model.

---

## The one principle everything else follows

**The AI never calculates. The calculation engine never interprets.**

Every number is produced by deterministic TypeScript in `src/lib/quant/` and stored in Postgres. The external agentic service receives those values as grounding, returns validated structured interpretation, and is never permitted to compute a weight, return, Sharpe ratio, or VaR figure.

This is enforced in three places, not just asked for in a prompt:

1. `src/lib/quant/` imports nothing from the agentic integration or `src/lib/fx/`.
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
cp .env.example .env.local
npm run db:migrate
npm run admin:create              # requires INITIAL_ADMIN_EMAIL/PASSWORD
npm run seed                      # optional demo portfolios and prices
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

## Deploying to Railway

The recommended Railway project contains three application services, two isolated
PostgreSQL resources and one private bucket:

```text
dashboard (public Next.js) ──private HTTP──> agentic-api (private)
        │                                      │
 dashboard-postgres                     agentic-postgres
                                               │
                                        agentic-worker ──> OpenAI
                                               │
                                        agentic-artifacts bucket
```

The project-level deployment definition lives in `.railway/railway.ts`. It
declares the three application services, both isolated PostgreSQL resources,
the private report bucket, Railpack builds, committed migrations, health checks,
restart policies and cross-service variables. Do not expose either agentic
service to the browser.

The root `railway.*.json` files are retained only while the already-running
dashboard is migrated away from Railway's deprecated per-service Config as Code.
Do not attach them to new services. Review a Railway IaC plan before applying;
an unexpected delete or database replacement is a stop condition.

For the first deployment, temporarily configure `INITIAL_ADMIN_EMAIL`,
`INITIAL_ADMIN_PASSWORD` and optionally `INITIAL_ADMIN_NAME`. The dashboard
pre-deploy step creates the first owner after migrations without Railway CLI or
SSH. Remove all `INITIAL_ADMIN_*` variables immediately after the successful
deployment. For the optional market refresh, create a Railway Cron service from
this repository with command `npm run cron:refresh` and a weekday schedule such
as `0 21 * * 1-5` UTC.

See `docs/RAILWAY-DEPLOYMENT.md` for the exact variable and service checklist.

### Authentication and cybersecurity

The dashboard uses email/password authentication with salted, memory-hard
scrypt hashes, revocable `HttpOnly` sessions, an eight-hour idle timeout,
database-backed login throttling and optional authenticator-app MFA. New
passwords are 15–128 characters; recovery codes are stored only as one-way
digests. Account owners can change their password or enroll MFA at
`/account/security`.

Browser responses include CSP, HSTS in production, anti-framing, MIME-sniffing,
referrer and permissions headers. Cross-origin mutations are rejected and all
queries use Drizzle's parameterized query builder. Dependency advisories, tests,
type checks and the production build run in `.github/workflows/security.yml`.

Application code cannot supply an edge WAF or volumetric DDoS absorption. The
required Cloudflare/Railway controls and incident checklist are documented in
`docs/CYBERSECURITY.md`.

---

## Layout

```
src/lib/quant/       Deterministic engine. No LLM calls. 32 tests.
  types.ts           RiskMetric — every metric carries its full methodology
  returns.ts         Simple, TWR (sub-period linked), MWR (bisection XIRR)
  risk.ts            Volatility, Sharpe, drawdown, VaR (historical + parametric)
  weights.ts         Position/sector/country weights, HHI, currency guard

src/lib/fx/          The ONLY place currencies mix. ECB rates + displayTotal().
packages/agentic-contract Shared strict Zod contract and cross-system validators
services/agentic/      Authenticated API, PostgreSQL worker, OpenAI pipeline, PDF and storage
src/lib/integrations   Dashboard grounding builder, HTTP client and manifest adapter
src/lib/connectors/  PriceProvider interface + deterministic stub (ADR-005 open)
src/lib/services/    Recompute chain, distributed job lock
src/lib/db/          Drizzle schema, ownership model and revocable sessions
src/app/api/         Session-protected dashboard and integration routes
tests/               Deterministic quant, FX, contract and authentication tests
```

### Frontend pages

The seven pages in the Master Build Specification use authenticated APIs for
interactive views. Read-only supporting pages may use owner-scoped Server
Components; every query is bound to the current session:

| Route | Purpose |
|---|---|
| `/` | Overview — native-currency totals, headline risk metrics per portfolio |
| `/allocation` | Sector / country / asset-class weight breakdown, one portfolio at a time |
| `/positions` | Sortable, filterable position table across portfolios |
| `/security/[ticker]` | Market & fundamentals, position, AI analysis, grounding audit trail |
| `/intelligence` | AI analysis feed — new candidates, changed recommendations, thesis violations |
| `/risk` | Every risk metric, drillable into full methodology, plus the VaR/normality caveat |
| `/decisions` | Append-only, searchable decision log |

Supporting pages — `/portfolio`, `/risk-kpis`, `/ai-insights`,
`/securities`, `/investment-thesis`, `/ai-stock-discovery`, `/agentic-system`,
`/candidates` — cover ground the spec's seven pages don't (thesis upload,
human-in-the-loop candidate review, provenance browsing) and remain reachable
under the Header's "More" menu rather than deleted.

---

## Design decisions worth knowing before you edit

**Why no QuantStats or Riskfolio-Lib.** The original architecture recommended them. Two things changed that: the move to TypeScript removed them as options, and the explainability requirement made them a poor fit anyway — they return bare floats, so every call would have been wrapped to attach methodology metadata. The primitives are ~150 lines of arithmetic and are fully tested here. A useful side effect: the `cvxpy` compilation risk that hung over the Python design is simply gone.

**Why bisection instead of Newton-Raphson for XIRR.** Newton converges faster but can diverge on irregular cash-flow patterns — which is precisely what a real portfolio produces. Bisection cannot fail to converge inside its bracket. Slower, and the right trade for a number a human will act on.

**Why a `job_locks` table instead of `pg_try_advisory_lock`.** Advisory locks are session-scoped and release when the connection closes. Serverless connections close constantly, often mid-job. A row with an explicit TTL survives that.

**Why the dashboard process does not execute agent jobs.** Reasoning jobs are owned by
the private agentic worker workspace. The dashboard starts a run over private
HTTP, stores its external identifier, validates the callback manifest and imports
it transactionally. This preserves the database and quantitative boundaries while
keeping deployment and schema evolution in one repository.

---

## What is NOT finished

Stated plainly, because a spec that overstates completeness is worse than no spec.

- **No real market data.** `StubProvider` generates a reproducible pseudo-random walk seeded from the ticker. Every row is tagged `source: 'stub'`. ADR-005 is open — Twelve Data and EODHD both list XSWX and BVMF, but fundamentals depth for those two exchanges specifically is unverified.
- **Risk-free rates are hardcoded** in `recompute.ts`. Sharpe is directionally useful and not yet trustworthy in absolute terms.
- **TWR ignores cash flows.** The function supports them; the recompute service doesn't yet pass transactions in. Until it does, TWR equals cumulative return. The metric carries a caveat saying so.
- **Railway resources are declared but not yet applied to the live project.** `.railway/railway.ts` defines the integrated API, worker, two databases, private bucket and service wiring. A live Railway plan must be reconciled with the existing dashboard before it is applied, and the shared `OPENAI_API_KEY` must be supplied outside Git.
- **Railway production credentials are not in Git.** PostgreSQL, session, service and cron secrets must be configured in Railway before deployment.

---

## Documents

| File | Contents |
|---|---|
| `docs/decision-log.md` | ADR-001 → ADR-011, full reasoning and trade-offs |
| `docs/architecture.md` | Components, data flow, dashboard IA, phasing |
| `docs/V0-DASHBOARD-BRIEF.md` | **Paste this into v0** — frontend spec only |
| `docs/AGENTIC-SYSTEM-HANDOFF.md` | Implemented 16-point dashboard/agentic contract reference |
| `docs/RAILWAY-DEPLOYMENT.md` | Railway services, variables, migration and bootstrap checklist |
| `docs/platform-comparison.md` | base44 / Replit / Vercel / Manus / Kimi evaluation |
| `docs/superseded/` | The Python/Replit design, retained for its reasoning. Not live guidance. |
| `CONTRIBUTING.md` | The architectural invariants that must not be broken |
