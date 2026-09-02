# Low-cost provider architecture

## Applied workflow

`Thesis → Finnhub universe → initial structural filters → 20–50 companies → Tavily/Brave Web Research Agent → 5–15 candidates → human review → EODHD price history → limited research-and-risk analyst`.

The application keeps immutable thesis versions, user ownership, approval mutations, market-data provenance, deterministic risk/valuation calculations and the provider budget gateway. Those are already aligned with the supplied design and are not replaced.

## Provider boundaries

| Layer | Provider | Purpose | Must not do |
| --- | --- | --- | --- |
| Discovery | Finnhub | Low-cost symbol universe for SIX and B3 | Final valuation or portfolio analytics |
| Research | Tavily / Brave | Source-backed qualitative research after the 20–50-company screen | Generate numeric facts without sources |
| Validation | EODHD | Accepted-candidate historical prices | Broad-universe scanning or structured financial statements |
| Analysis | Agentic worker | Source-backed qualitative thesis fit plus supplied deterministic price-risk metrics | Infer missing financial facts or valuation |
| Calculation | Local deterministic code | Risk and return | Infer facts; run DCF without authoritative statement inputs |

## Current structural-filter coverage

The Finnhub symbol-list endpoint reliably supplies exchange, identity and security type, so the implemented first pass excludes non-equities and confines each mandate to its intended Swiss or Brazilian exchange. Sector and size filtering is applied only when the discovery record actually carries those fields; Finnhub's symbol-list response does not guarantee them. The system therefore records the absence rather than inventing a sector or market-cap value.

To make sector/size hard filters for every name, the next provider increment must add a documented profile/screener endpoint (for example FMP) and persist its measured coverage for SIX and B3. It should not be enabled merely by adding an API key.

## Fallback and data-quality rules

- A successful discovery universe is cached for `DISCOVERY_UNIVERSE_CACHE_HOURS` (default seven days).
- If Finnhub is down, the system uses only a non-expired cached universe; it never uses synthetic data.
- If no cache is available and `DISCOVERY_FALLBACK_PROVIDER=eodhd`, EODHD may provide the universe. This is explicit because it consumes the validation budget.
- EODHD calls happen only after an approved candidate begins analysis and are
  limited to historical prices.
- Finnhub is discovery-only. Neither approved-candidate analysis nor the daily
  refresh calls Finnhub Basic Financials.
- Approved candidates run in `limited_research_risk` mode: source-backed
  discovery evidence is combined with deterministic price-risk metrics. The
  analyst must disclose that structured statements are absent.
- DCF is locked in both the client and valuation API for this mode. It can be
  re-enabled only by a future, explicit full-fundamentals workflow with
  authoritative free cash flow, debt, cash and shares-outstanding evidence.
- Every consumed price observation retains provenance.

## Railway configuration

Set `DISCOVERY_*` and `MARKET_DATA_*` on the dashboard service. Set `WEB_SEARCH_*` only on the `agentic-worker` service, which performs web research:

```env
DISCOVERY_PROVIDER=finnhub
FINNHUB_API_KEY=<Finnhub API key>
DISCOVERY_FALLBACK_PROVIDER=eodhd
DISCOVERY_UNIVERSE_CACHE_HOURS=168

WEB_SEARCH_PROVIDER=tavily
WEB_SEARCH_API_KEY=<Tavily API key>

MARKET_DATA_PROVIDER=eodhd
MARKET_DATA_API_KEY=<EODHD API key>
```

Never expose any of these values through `NEXT_PUBLIC_*` variables or browser code.

## API-key decision

Get these keys, in this order:

1. **Tavily API key — get now.** It supplies research evidence. Tavily currently documents a free key with 1,000 monthly credits and no card requirement. Use `WEB_SEARCH_PROVIDER=tavily` and put the key in `WEB_SEARCH_API_KEY`.
2. **Finnhub API key — get now and test before relying on it.** It supplies breadth-first discovery. The adapter uses Finnhub's documented Stock Symbols endpoint and passes `SW` for SIX and `SA` for B3; verify both exchanges with your own key before considering coverage confirmed.
3. **Keep your EODHD API key.** It supplies approved-candidate historical prices for deterministic risk. The application does not request its fundamentals endpoint. A future full-data/DCF mode requires a separately designed and entitled structured-statements provider.

The system intentionally does not require FMP. Adding it now would create a second discovery provider without measured exchange coverage or a tested fallback benefit. It remains a future option behind the same provider boundary.
