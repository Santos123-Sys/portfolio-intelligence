# v0 Brief — Portfolio Intelligence Dashboard

> **This is the only document to give v0.** The rest of the repo describes a Python backend, a quantitative engine, and Replit deployment topology — none of which v0 can act on. Including them dilutes the signal and produces worse UI.

---

## Read this first: the Next.js constraint

v0 generates Next.js by default. The backend architecture serves the frontend as a static build mounted by FastAPI:

```python
app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
```

**A Next.js app using server components or server-side data fetching cannot be served this way.** Three options:

| Option | Result |
|---|---|
| **A. Ask v0 for a static-exportable app** — client components only, `output: 'export'` | Single origin, no CORS, matches ADR-009. **Recommended.** |
| **B. Host frontend on Vercel, backend on Replit** | Two platforms, CORS config required, reintroduces the split ADR-009 removed |
| **C. Ask v0 for plain Vite + React** | Matches the original stack exactly; v0 is less optimized for it |

If you take option A, the instruction to v0 is: *"Client components only. No server actions, no server-side data fetching. All data arrives via fetch() from a REST API at runtime."*

---

## What this app is

A single-user investment dashboard for two equity portfolios and a fixed-income sleeve. It is a **read-and-decide** tool, not a trading terminal — no order entry, no execution. The user reviews AI-generated analysis alongside deterministically calculated risk and performance figures, then acts elsewhere.

The two portfolios:
- **Swiss Quality** — CHF-denominated, capital preservation and stability
- **Brazilian Growth** — BRL-denominated, capital appreciation
- **Fixed Income & Liquidity** — cash and bond positions

---

## Non-negotiable rules

These are architectural decisions, not preferences. Breaking them makes the UI wrong, not just different.

1. **Never blend currencies in a calculated metric.** Sharpe ratio, VaR, volatility, correlation, drawdown, and returns are shown **per portfolio in that portfolio's native currency**. A CHF Sharpe and a BRL Sharpe never combine into one number. Ever.

2. **The one exception is total value, and it is display-only.** The Overview page shows a combined total with a currency picker (CHF / BRL). Converting is cosmetic. It must be visually marked as a conversion — a subtle label, not a warning banner. It never feeds any other figure on any page.

3. **Every risk number is clickable and reveals its methodology.** A VaR figure without a visible "how was this computed" drill-down is a bug. The drill-down shows: method (historical / parametric / Monte Carlo), confidence level, horizon, lookback period, and data timestamp.

4. **AI output and calculated numbers are visually distinguishable.** The user must always be able to tell at a glance whether they are looking at something computed or something inferred. AI-generated text always displays its confidence score and its analysis timestamp.

5. **No fabricated precision.** If a value is stale or missing, show it as stale or missing. Never render a placeholder that looks like real data.

---

## Pages

### 1. Overview
- Combined total value with currency picker (CHF/BRL), marked as converted
- Per-portfolio cards: native-currency value, daily P&L, headline risk (VaR, Sharpe, max drawdown) — each labeled with its currency
- Exposure breakdown by asset class and portfolio role
- Recent AI intelligence items (3–5, linking to page 5)

### 2. Allocation
- Weight breakdowns: asset class, country, sector, position, portfolio role
- Visual: donut or treemap per dimension, with a table beneath
- Toggle between portfolios; no combined-allocation view

### 3. Positions
Sortable, filterable table. AI score and thesis alignment are **columns in this table**, not a separate section:

| Ticker | Name | Portfolio | Qty | Avg Cost | Market Value | Weight | Day Δ | AI Score | Thesis Alignment | Risk Flag |

Row click → Security Detail.

### 4. Security Detail
One page, four regions:
- **Market & fundamentals** — price, sector, country, exchange, key ratios
- **Position** — quantity, cost basis, current value, weight, contribution to portfolio risk
- **AI analysis** — investment thesis, catalysts, risks, thesis-breakers, sub-scores (quality/growth/risk/dividend), confidence, timestamp, and which thesis version it was scored against
- **Grounding** — an explicit list of the calculated values the AI's conclusion rested on, by metric name and timestamp

### 5. AI Intelligence Feed
Chronological stream of three item types, visually distinct:
- **New candidate** — a security Agenteki flagged as thesis-aligned
- **Changed recommendation** — shown as a **diff against the previous version**, not a silent overwrite
- **Thesis violation** — an existing holding that no longer meets criteria

### 6. Risk Detail
The explainability surface. Every risk metric, per portfolio, in native currency, with full methodology exposed. Include a visible caution: VaR on a concentrated 10–30 position portfolio can look more precise than it is.

### 7. Decision Log
Append-only, filterable, read-only. Each entry: date, decision, reasoning, alternatives considered, outcome if known.

---

## Data shapes

Generate against these. Use realistic mock data — the backend does not exist yet.

```ts
type Currency = 'CHF' | 'BRL' | 'USD' | 'EUR';
type PortfolioType = 'swiss_quality' | 'brazilian_growth' | 'fixed_income';

interface Portfolio {
  id: string;
  name: string;
  portfolioType: PortfolioType;
  baseCurrency: Currency;        // native currency — all metrics reported in this
  investmentObjective: string;
  totalValueNative: number;
  dayChangeNative: number;
  dayChangePct: number;
}

interface Position {
  id: string;
  portfolioId: string;
  ticker: string;
  companyName: string;
  exchange: string;              // 'XSWX' | 'BVMF' | ...
  currency: Currency;
  sector: string;
  country: string;
  quantity: number;
  avgCost: number;
  marketValueNative: number;
  weight: number;                // 0–1
  dayChangePct: number;
  aiScore: number | null;        // 0–100
  thesisAlignment: number | null;// 0–100
  riskFlag: 'none' | 'watch' | 'breach';
}

interface RiskMetric {
  metricName: string;            // 'VaR' | 'Sharpe' | 'MaxDrawdown' | 'Volatility'
  value: number;
  currency: Currency;            // never null — every metric is currency-scoped
  methodology: string;           // 'historical' | 'parametric' | 'monte_carlo' | 'n/a'
  confidenceLevel: number | null;// e.g. 0.95
  horizonDays: number | null;
  lookbackDays: number | null;
  computedAt: string;            // ISO
  dataAsOf: string;              // ISO — may differ from computedAt
}

interface AIAnalysis {
  id: string;
  securityId: string;
  thesisVersionId: string;
  portfolioRole: PortfolioType | 'not_suitable';
  investmentScore: number;       // 0–100
  thesisAlignmentScore: number;
  qualityScore: number;
  growthScore: number;
  riskScore: number;
  dividendScore: number;
  fundamentalSummary: string;
  investmentThesis: string;
  keyCatalysts: string[];
  keyRisks: string[];
  thesisBreakers: string[];
  confidenceScore: number;       // 0–1
  groundedIn: string[];          // metric names + timestamps the AI relied on
  analysisTimestamp: string;
  dataTimestamp: string;
  agentVersion: string;
}

interface FeedItem {
  id: string;
  type: 'new_candidate' | 'changed_recommendation' | 'thesis_violation';
  securityId: string;
  ticker: string;
  headline: string;
  detail: string;
  previousVersion?: Partial<AIAnalysis>;  // present on changed_recommendation
  createdAt: string;
}
```

---

## Design direction

**Register:** a professional research workstation, not a consumer fintech app. The user has a capital-markets background — dense information is welcome, decorative gauges and gamified progress rings are not.

- Information density over whitespace, but never at the cost of scannability
- Data-ink discipline: no chart junk, no 3D, no gradients on data marks
- Restrained palette. Reserve saturated color for genuine signal (risk breach, thesis violation) so it stays meaningful
- Numbers in a tabular-figure typeface so columns align
- Dark and light themes both viable — dark tends to suit long analysis sessions
- Charts: Recharts is sufficient throughout

**Anti-pattern to avoid:** the "AI insight card" that renders confident prose with no visible provenance. Every AI statement in this UI carries a confidence score, a timestamp, and a path back to the numbers behind it.

---

## Explicitly out of scope for v0

Do not generate: authentication, order entry, trade execution, broker integrations, any calculation logic, any data fetching from real APIs. All computation happens in the Python backend. The frontend renders what the API returns and nothing more.
