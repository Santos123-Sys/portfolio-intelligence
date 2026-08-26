> **SUPERSEDED by ADR-010.** The project moved to Vercel + Next.js. This document is retained for the reasoning behind the three-deployment split and the platform constraints research, not as live deployment guidance.

# Replit deployment architecture

**Companion to** `investment-system-architecture.md`. That document defines *what* the system is. This one defines *how it runs on Replit* — and where Replit's constraints force changes to the original design.

**Verified:** August 2026. Replit's pricing and deployment products change frequently — re-check before committing spend.

---

## 1. The floor: Core plan is mandatory

The free Starter plan only allows **public** Repls. Public Repls expose all source code, file contents, and commit history — everything except Secrets.

For this project that means your thesis criteria, scoring logic, risk methodology, and every commit message would be world-readable. Your API keys stay protected (Secrets are encrypted separately) and holdings live in Postgres rather than in code, but the strategy itself would not be private.

**Core: ~$20/month billed annually, ~$25/month billed monthly.** Not optional for this project.

Note: "private Repl" (source hidden) and "private publishing" (network-level access control on the deployed app) are two different settings. You want both.

---

## 2. Three deployments, not one

The original architecture lists a `Scheduler` component with the note "Cron is enough at this scale."

**On Replit that is impossible inside the main app.** Autoscale deployments scale to zero when idle; a cron thread inside a process that gets shut down does not run.

Replit therefore forces the scheduler into separate deployments. This is an improvement, not a workaround — it enforces ADR-001's separation of AI reasoning from deterministic calculation at the infrastructure level rather than by convention.

| # | Deployment | Runs | Type | Schedule |
|---|---|---|---|---|
| 1 | App | FastAPI serving API + built React frontend | Autoscale | On demand |
| 2 | Data refresh | Price fetch, FX fetch, quant engine recompute | Scheduled | Daily, after both market closes |
| 3 | Agenteki | Thesis parse, screen, analyze, score | Scheduled | Weekly, or triggered via job queue |

All three read and write the same PostgreSQL database. That database is the single source of truth, exactly as the main architecture requires.

### Scheduled deployment mechanics

- Timeout: 11 hours (far more than either job needs)
- Minimum granularity: 1 minute
- **No concurrency limit** — overlapping runs are possible if a job outlives its interval

The concurrency point matters. Write an advisory lock into the refresh job:

```sql
SELECT pg_try_advisory_lock(12345);
```

Two concurrent runs writing FX rates is silent data corruption of exactly the kind that's miserable to debug months later.

---

## 3. Services to attach

**Required, in order:**

1. **Core plan** — see Section 1
2. **Private Repl** — Settings → visibility → Private, *before* committing anything real
3. **PostgreSQL** — Tools → Database → Create. Managed PostgreSQL 16 on Neon; auto-injects `DATABASE_URL` into Secrets. A "Helium" variant runs on Replit's own infrastructure with 20 GB storage instead of Neon's 10 GB, same engine. Either is ample at this data volume.
4. **Secrets** — LLM API key, market data vendor key, FX source credentials
5. **Object Storage** — mandatory, see Section 4
6. **GitHub connection** — portability escape hatch, see Section 6

**Then:** Publish → Autoscale (app), Publish → Scheduled ×2 (jobs).

**Deliberately not attached: Replit Agent for the quant engine or Agenteki pipeline.**

Use Agent freely for boilerplate — CRUD routes, React scaffolding, migration files. Do not use it to generate risk math or the scoring pipeline. The entire architecture rests on numbers being verifiably correct, and Agent charges per checkpoint regardless of whether the operation succeeded. Auto-generated risk calculations that look plausible are precisely the failure mode ADR-001 exists to prevent.

---

## 4. Three constraints that change the existing design

### 4.1 The filesystem is ephemeral

Replit's filesystem resets on every deploy.

**Breaks:** Phase 1 step 2 (manual/CSV position entry). A CSV written to disk vanishes on the next publish.

**Fix:** Route uploads directly into Postgres. Put generated artifacts — QuantStats HTML tearsheets, PDF exports — in Object Storage.

### 4.2 Agenteki cannot run inside an HTTP request

A full pipeline run is minutes of LLM calls with unpredictable duration. It must not sit behind `POST /api/analyze`.

**Pattern:**
1. Endpoint writes a job row, returns `202 Accepted` immediately
2. Scheduled deployment #3 polls for pending jobs and executes
3. Dashboard polls for completion

The `AI_ANALYSIS` table already carries `analysis_timestamp`. Add a `status` column (`pending` / `running` / `complete` / `failed`) and this works with minimal change.

### 4.3 Deployment secrets do not inherit from the workspace

Workspace secrets do **not** carry over to deployments. Each secret must be added separately in the Deployments pane before publishing.

Three deployments = adding each secret three times. This is the single most common source of "it worked in the workspace" confusion on the platform.

Mitigation: a `config.py` that validates every required secret at startup and fails loudly with the missing key's name.

---

## 5. Repository structure

```
/
├── .replit                        # run command + deployment config
├── pyproject.toml                 # Python dependencies
├── backend/
│   ├── main.py                    # FastAPI app; mounts frontend/dist
│   ├── config.py                  # reads Secrets, validates at startup
│   ├── db/
│   │   ├── models.py              # SQLAlchemy: Portfolio, Security, Position,
│   │   │                          #   Transaction, FXRate, ThesisVersion,
│   │   │                          #   AIAnalysis, Alert, DecisionLogEntry
│   │   └── session.py
│   ├── quant/
│   │   ├── weights.py
│   │   ├── returns.py             # TWR / MWR
│   │   └── risk.py                # Sharpe, VaR, drawdown
│   ├── agenteki/
│   │   ├── pipeline.py            # hand-rolled DAG (ADR-006)
│   │   └── schemas.py             # structured output contract
│   ├── connectors/
│   │   ├── base.py                # abstract interface (ADR-005 portability)
│   │   ├── prices.py
│   │   └── fx.py                  # ECB daily reference rates
│   └── api/routes/
├── jobs/                          # Scheduled Deployment entry points
│   ├── refresh_market_data.py
│   └── run_agenteki.py
└── frontend/
    ├── src/
    └── dist/                      # built by Vite, served by FastAPI
```

The `jobs/` directory is the Replit-specific addition. Each file is a plain script with no framework dependency — see Section 6.

### `.replit`

```ini
run = "cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000"
```

### Serving the frontend from FastAPI

```python
from fastapi.staticfiles import StaticFiles

app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
```

Single origin means no CORS configuration and no separate frontend deployment. For a single-user system this is the correct simplification.

---

## 6. Portability discipline

This decision reverses the main architecture's self-hosting recommendation (which was justified on financial-data sensitivity grounds). The honest mitigation is keeping the exit cheap.

**Three rules:**

1. **Standard PostgreSQL only.** No Neon-specific features. `pg_dump` must produce a fully portable database.
2. **Configuration through `os.environ` only.** Never Replit-specific globals. Note that `REPLIT_DEV_DOMAIN` does not exist even in Replit's own deployments — relying on it breaks on-platform, let alone off it.
3. **Job entry points as plain scripts.** `python jobs/refresh_market_data.py` must run identically under Replit's scheduler, a Railway cron, or a local machine.

Follow these and migrating to Railway or a VPS later is an afternoon of work, not a rewrite.

---

## 7. Cost

| Line item | Cost |
|---|---|
| Core plan | $20/mo annual (~$25 monthly), includes $20 usage credits |
| Autoscale deployment | $2.00/mo base + $0.60/million compute units + $0.40/million requests |
| Scheduled deployment ×2 | $2.00/mo base each + compute; scheduler itself is free |
| PostgreSQL | Usage-based; idles after 5 min inactivity, pausing compute billing |

**Realistic total: $25–30/month** for single-user traffic.

Watch the credit model: the subscription buys a pool of credits, and Agent usage, development compute, and deployments all draw from it. Once credits are exhausted, billing switches to pay-as-you-go. Agent usage is the least predictable line — another reason to keep it away from the quant engine.

---

## 8. Known unknowns

- **Autoscale HTTP request timeout** — not confirmed. The async-job pattern in 4.2 is correct regardless, but verify before relying on any long-running request.
- **Riskfolio-Lib installation** — depends on `cvxpy`, which needs compilation. Plausible under Replit's Nix environment but unverified. Test this early; it's a genuine go/no-go for the risk engine.
- **Memory ceiling** — roughly 2 GiB free tier, 8 GiB on Core. Fine for a 10–30 position portfolio. Monte Carlo runs or large correlation matrices could pressure it.
