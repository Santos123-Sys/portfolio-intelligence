# Deterministic Python engines

This reference package implements the system’s three code-backed policies:

- `dcf`: FCFF or FCFE valuation scenarios from human-confirmed, source-linked inputs;
- `comparables`: peer multiple statistics and implied-value scenarios from six to ten human-reviewed peers;
- `risk`: point-in-time price-series risk metrics.

It deliberately has no network or LLM dependency. It does not choose peers,
retrieve data, construct assumptions, or make investment recommendations.

## Current integration boundary

The deployed Next.js app remains on the TypeScript engines in `src/lib/quant`.
This Python module is a reference engine for parity testing, controlled batch
jobs, or a later separately deployed worker. Do not route production decisions
to it until a JSON-schema contract, golden test fixtures, and parity gate are
approved.

## Usage

```bash
python3 python/deterministic_engines.py dcf path/to/dcf.json
python3 python/deterministic_engines.py comparables path/to/comparables.json
python3 python/deterministic_engines.py risk path/to/risk.json
python3 -m unittest python.test_deterministic_engines
```

The CLI exits with code `2` and writes `engine_error:` to stderr for invalid,
missing, mixed-currency, or unapproved inputs.

## Input contract

All values are JSON numbers in the stated native currency (not formatted
strings). Every source reference should identify the filing, market-data
snapshot, approved analyst pack, or decision-log entry that supports it.

### DCF

`dcf` requires `human_confirmed: true`, an `approval_reference`, a same-currency
and same-basis discount rate, `risk_free_rate`, terminal assumptions, an explicit
year-end forecast (one to ten years), and the full enterprise-to-equity bridge:
net debt, minority interest, preferred stock, non-operating assets, and diluted
shares. Each forecast year explicitly provides EBIT, tax, D&A, capex, and change
in NWC for FCFF; FCFE replaces EBIT/tax with net income and adds change in net
debt. FCFF uses a terminal ROIC check; FCFE uses terminal return on equity.
Missing inputs halt rather than becoming zero. FCFF bridges discounted value to
enterprise value and then equity value; FCFE produces equity value directly.

`discount_rate_components` is optional. When provided, the engine calculates
bottom-up-beta WACC from supplied market values and requires it to reconcile to
the approved WACC (FCFF) or cost of equity (FCFE) within one basis point. It also
prevents country risk from being included both in beta and separately.

### Comparable companies

`comparables` requires `human_confirmed: true`, an `approval_reference`, one
target and six to ten peers in the target's native currency. Every peer requires
a unique ticker, human-review flag, selection rationale, source references,
market capitalization and net debt. The engine reports LTM/NTM EV/Revenue,
EV/EBITDA, and P/E where positive denominators exist; it also reports available
profitability, growth and leverage metrics. IQR outliers are marked for review,
never removed automatically.

### Risk

`risk` requires one native-currency price series with at least 31 dated,
positive observations and a source reference. It returns volatility, drawdown,
historical and parametric VaR, plus historical expected shortfall. Sharpe,
beta, and correlation appear only when their same-currency inputs are supplied.
No accounting normalization is implied by the price-series metrics.
