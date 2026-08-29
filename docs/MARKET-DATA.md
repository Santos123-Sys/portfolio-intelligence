# Market data providers

ADR-005 ("market data vendor selection") is still open, for one reason:
**nobody has confirmed that a vendor actually returns data for SIX Swiss
(XSWX) and B3 (BVMF)**, as opposed to listing them on a marketing page.
`assertCoversRequiredExchanges` in `connectors/base.ts` makes that a hard
constraint — a provider missing either exchange is unusable here regardless of
how good it is elsewhere.

`EodhdProvider` is wired in and is the intended production provider. Its
coverage on a real key has still never been checked. This document records the
options and, more usefully, how to settle the question with evidence.

## Providers in the repo

| Provider | Key | Prices | Fundamentals | Notes |
|---|---|---|---|---|
| `stub` | no | synthetic | synthetic | Reproducible pseudo-random walk. Every row tagged `source: 'stub'`. |
| `stooq` | **no** | daily OHLCV | **none** | Free, no signup, no quota. Prices only. |
| `eodhd` | yes | yes | yes | The intended production provider. Coverage unverified. |
| `yahoo-search` | search key | best-effort | best-effort | Goes through a web-search provider deliberately — see below. |
| `twelvedata` | yes | yes | yes | Not implemented. 800 calls/day free; documents both exchanges. |

### Why `stooq` exists alongside `eodhd`

EODHD needs a key, an account, and a plan whose tier includes the exchanges in
question — and a tier limit fails at runtime looking much like absent data.
Stooq needs nothing: no signup, no quota, plain CSV. It is the option that
works today while a key is being sorted out, and a useful second opinion when
an EODHD result looks wrong.

Its cost is that it publishes **no fundamentals**. `StooqProvider` therefore
does not implement `getFundamentals` at all, rather than returning `{}`.
`PriceProvider` makes the method optional precisely so a price-only source can
be honest, and an empty return would make `recordFundamentalObservations` write
a successful-looking record claiming a source had been consulted. Note that the
DCF engine needs fundamentals, so Stooq alone cannot feed a valuation.

### Why not Yahoo directly

`src/lib/connectors/yahoo-search.ts` goes through a web-search provider
specifically to avoid Yahoo's undocumented `chart` and `quoteSummary`
endpoints — its header says so. That was a deliberate stance. Reversing it
should be an ADR that states the ToS and breakage risk, not a new connector
file that quietly does it.

## Confirming coverage

```bash
npm run verify:provider                                  # stooq, no key needed
MARKET_DATA_API_KEY=... npm run verify:provider eodhd     # the real provider
```

Run from anywhere with open outbound network access — a Railway shell, or a
laptop. Neither path needs a database.

Both fetch real, liquid listings on each required exchange (Nestlé and Roche on
SIX; WEG and Petrobras on B3) plus a US control, and print what came back. The
EODHD path drives the real `EodhdProvider`, so a pass confirms the provider *as
configured*, not merely that the vendor has the data somewhere.

**The control probe is load-bearing.** If it fails too, the run reports
`INCONCLUSIVE` rather than "not covered" — a blocked network, a bad key or an
exhausted quota would otherwise read as a missing exchange and get a working
vendor discarded on false evidence.

Exit code is 0 only when every required exchange returned data, so this is safe
to gate a deploy on.

### Stooq symbol suffixes are guesses

Stooq's suffixes are country-based and undocumented, so `STOOQ_SUFFIX` in
`stooq.ts` holds consistent guesses (`.CH`, `.BR`), not confirmed values.
Coverage could not be verified from the environment the connector was written
in — that network blocked `stooq.com` outright. When a probe fails, the script
retries alternatives and names the fix:

```
STOOQ_SUFFIX needs correcting in src/lib/connectors/stooq.ts:
  XSWX: '.CH' -> '.SW'
```

Do not set `MARKET_DATA_PROVIDER=stooq` before running it.

## If EODHD's plan does not cover both exchanges

The fallback is **Twelve Data's free tier**: 800 calls/day is ample for a daily
refresh of a 10–30 position portfolio, it publishes fundamentals, and it
documents both exchanges. It is one new file next to `eodhd.ts` plus one case
in `getPriceProvider` — the `PriceProvider` interface exists for exactly this.
