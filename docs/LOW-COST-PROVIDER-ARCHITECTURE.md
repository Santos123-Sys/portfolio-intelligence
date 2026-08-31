# Low-cost provider architecture

## Applied workflow

`Thesis → Finnhub/FMP universe → initial structural filters → 20–50 companies → Tavily/Brave Web Research Agent → 5–15 candidates → human review → EODHD validation → Financial Analyst → valuation`.

The application keeps immutable thesis versions, user ownership, approval mutations, market-data provenance, deterministic risk/valuation calculations and the provider budget gateway. Those are already aligned with the supplied design and are not replaced.

## Provider boundaries

| Layer | Provider | Purpose | Must not do |
| --- | --- | --- | --- |
| Discovery | Finnhub | Low-cost symbol universe for SIX and B3 | Final valuation or portfolio analytics |
| Research | Tavily / Brave | Source-backed qualitative research after the 20–50-company screen | Generate numeric facts without sources |
| Validation | EODHD | Accepted-candidate prices and fundamentals | Broad-universe scanning |
| Calculation | Local deterministic code | Risk, return, valuation and attribution | Infer facts |

## Current structural-filter coverage

The Finnhub symbol-list endpoint reliably supplies exchange, identity and security type, so the implemented first pass excludes non-equities and confines each mandate to its intended Swiss or Brazilian exchange. Sector and size filtering is applied only when the discovery record actually carries those fields; Finnhub's symbol-list response does not guarantee them. The system therefore records the absence rather than inventing a sector or market-cap value.

To make sector/size hard filters for every name, the next provider increment must add a documented profile/screener endpoint (for example FMP) and persist its measured coverage for SIX and B3. It should not be enabled merely by adding an API key.

## Fallback and data-quality rules

- A successful discovery universe is cached for `DISCOVERY_UNIVERSE_CACHE_HOURS` (default seven days).
- If Finnhub is down, the system uses only a non-expired cached universe; it never uses synthetic data.
- If no cache is available and `DISCOVERY_FALLBACK_PROVIDER=eodhd`, EODHD may provide the universe. This is explicit because it consumes the validation budget.
- EODHD calls happen only after an approved candidate begins analysis.
- Every provider call is budgeted and every consumed market/fundamental observation retains provenance.

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
3. **Keep your EODHD API key.** It remains the validation provider. Do not spend it for broad discovery. EODHD's free tier is insufficient for a recurring multi-market validation workflow because it is limited to 20 calls per day and has restricted fundamentals; buy only the plan that demonstrably includes the required SIX/B3 fundamentals endpoints.

The system intentionally does not require FMP. Adding it now would create a second discovery provider without measured exchange coverage or a tested fallback benefit. It remains a future option behind the same provider boundary.
