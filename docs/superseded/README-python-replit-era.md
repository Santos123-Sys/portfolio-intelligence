> **SUPERSEDED by ADR-010.** This was the consolidated project overview when the system was planned as a Python/FastAPI application hosted on Replit. Retained for the reasoning and research references. The live README is at the repository root.

# AI Investment Management & Portfolio Intelligence System

Personal-use system for managing two equity portfolios plus a fixed-income sleeve, combining AI-assisted investment reasoning with a deterministic quantitative engine.

**Status:** Architecture complete, all blocking decisions resolved. Implementation not started.
**Scope:** Single investor. Swiss Quality equities (CHF) · Brazilian Growth equities (BRL) · Fixed Income & Liquidity.

---

## The core principle

**The AI never calculates. The calculation engine never interprets.**

Every number in this system is produced by deterministic Python and stored in PostgreSQL. The AI layer ("Agenteki") reads those numbers as grounding for its reasoning, writes structured interpretation back to the database, and is never permitted to compute a weight, a return, a Sharpe ratio, or a VaR figure — not even as a sanity check.

This is not a stylistic preference. Research reviewed during design converged on the same finding: LLMs are fluent but not arithmetic-competent, and the fix is architectural, not a better model. Ghostfolio (open-source portfolio tracker) and Addepar's institutional "Addison" AI both independently converged on the same pattern.

---

## Architecture at a glance

```
Investment thesis ──► Agenteki ──► Structured output ─┐
                         ▲                             ▼
Market + FX data ──► Ingest/validate ──► PostgreSQL ──► Quant engine ──► PostgreSQL ──► Dashboard ──► Human
                                             │              │
                                             └──────────────┘
                                        (grounding loop: AI reads
                                         computed values, never writes them)
```

**Three layers:**

| Layer | Contains | Never does |
|---|---|---|
| **1. Agenteki (AI)** | Thesis parsing, screening, fundamental analysis, thesis alignment, risk flagging, scoring | Any arithmetic. Any trade execution. |
| **2. Data + Quant** | Ingestion, validation, FX rates, all calculations (weights, TWR/MWR, volatility, Sharpe, drawdown, VaR, correlation) | Interpret. Recommend. |
| **3. Dashboard** | Visualization, drill-down, decision support | Recalculate anything. Let AI prose override a calculated number. |

The human executes all trades. The system never does.

---

## Resolved decisions

Nine architecture decisions are logged in `decision-log.md`. The four that shape everything else:

| Decision | Choice | Why it matters |
|---|---|---|
| **ADR-004** Build vs. buy | Full custom build | You own the transaction ledger, currency conversion, and TWR/MWR calculation as build scope — everything Ghostfolio would have given free. |
| **ADR-002** Currency reporting | **Native per portfolio, no blending** | Sharpe/VaR/correlation computed in CHF for Swiss, BRL for Brazilian. One display-only total via a live currency picker, never feeding a calculated metric. |
| **ADR-008** Hosting | Replit | Supersedes the original self-hosting recommendation. Accepted trade-off, mitigated by strict portability discipline. |
| **ADR-009** Deployment shape | Three deployments, one database | Forced by Replit's scale-to-zero model; kept because it enforces the AI/calculation separation at the infrastructure level. |

---

## Build order (Phase 1)

There is no separate Phase 0. The validation it would have provided is folded into Phase 1's internal sequencing:

1. **Database schema** + manual/CSV position entry. No calculations yet.
2. **Quant engine: weights and simple returns** — checked by hand against a broker statement before anything is built on top.
3. **Full performance and risk** (TWR/MWR, Sharpe, drawdown, VaR) on the validated foundation.
4. **Agenteki** — thesis parsing, screening, structured output, writing to the same database.
5. **Dashboard** — reading from the now-validated, now-populated database.

The ordering guarantee: if a number is wrong, you know it's wrong in the quant engine, rather than hunting across three simultaneously-new layers.

**Phases 2–4:** reliable market data → risk dashboard → thesis monitoring and alerts → multi-portfolio and optimization.

> ⚠️ **Phase 4 legal note:** multi-user expansion triggers U.S. Investment Advisers Act registration and fiduciary duties if the system provides advice to others for compensation. Irrelevant now; becomes real at that phase.

---

## Stack

**Required**
- Python (backend + entire quant ecosystem)
- PostgreSQL (relational state + time-series prices/FX; TimescaleDB if volume grows)
- A market data vendor with confirmed SIX Swiss (XSWX) **and** B3 (BVMF) coverage

**Chosen**
- FastAPI — thin, typed, sufficient at single-user scale
- QuantStats — Sharpe, Sortino, drawdown, volatility, Monte Carlo, HTML tearsheet
- Riskfolio-Lib — 26 convex risk measures, CVaR, Black-Litterman *(build risk: depends on `cvxpy`, needs compilation — test early)*
- Hand-rolled orchestration for Agenteki over LangGraph/CrewAI — the pipeline is a fixed DAG, not dynamic branching
- Replit — three deployments (see `replit-deployment-architecture.md`)

**Data vendors — shortlist, not decided**
Twelve Data and EOD Historical Data both explicitly list XSWX and BVMF. Fundamentals *depth* for those two exchanges specifically is unverified — check directly before committing. Fiscal.ai is available via MCP but SIX/B3 depth is unconfirmed.

> **Dead vendor warning:** IEX Cloud shut down entirely on August 31, 2024. Keep every data connector behind an abstract interface so a vendor's death is a config change, not a rewrite.

---

## Repository structure

```
/
├── .replit                        # run command + deployment config
├── pyproject.toml
├── backend/
│   ├── main.py                    # FastAPI app; mounts frontend build
│   ├── config.py                  # reads Secrets, validates at startup
│   ├── db/
│   │   ├── models.py              # Portfolio, Security, Position, Transaction,
│   │   │                          #   FXRate, ThesisVersion, AIAnalysis,
│   │   │                          #   Alert, DecisionLogEntry
│   │   └── session.py
│   ├── quant/
│   │   ├── weights.py
│   │   ├── returns.py             # TWR / MWR
│   │   └── risk.py                # Sharpe, VaR, drawdown
│   ├── agenteki/
│   │   ├── pipeline.py            # hand-rolled DAG
│   │   └── schemas.py             # structured output contract
│   ├── connectors/
│   │   ├── base.py                # abstract interface — vendor portability
│   │   ├── prices.py
│   │   └── fx.py                  # ECB daily reference rates
│   └── api/routes/
├── jobs/                          # Scheduled Deployment entry points
│   ├── refresh_market_data.py
│   └── run_agenteki.py
└── frontend/                      # ◄── the part v0 generates
    ├── src/
    └── dist/
```

---

## Documents in this repo

| File | Contains |
|---|---|
| `README.md` | This file — consolidated overview |
| `investment-system-architecture.md` | Full architecture: components, data flow, DB schema, dashboard IA, phasing, research references |
| `replit-deployment-architecture.md` | Replit-specific: three deployments, services to attach, platform constraints, costs, portability rules |
| `decision-log.md` | ADR-001 through ADR-009 with full reasoning and trade-offs |
| `platform-comparison.md` | base44 / Replit / Vercel / Manus / Kimi evaluated on security, free tiers, hosting, multi-agent support |
| `V0-DASHBOARD-BRIEF.md` | **Paste this into v0** — focused frontend spec, nothing else |

---

## Known unknowns

Carried forward deliberately rather than guessed at:

- **Riskfolio-Lib / `cvxpy` compilation on Replit's Nix environment** — unverified. This is a genuine go/no-go for the risk engine. Test it first; it's a five-minute check.
- **Replit Autoscale HTTP request timeout** — exact figure unconfirmed. The async-job pattern is correct regardless, but verify before relying on any long request.
- **Data vendor fundamentals depth for XSWX and BVMF specifically** — marketing pages confirm the exchanges exist in the platform; they are much less reliable about depth of fundamentals per exchange.
- **Memory ceiling** — ~2 GiB free tier, 8 GiB on Replit Core. Fine for 10–30 positions. Monte Carlo or large correlation matrices could pressure it.
