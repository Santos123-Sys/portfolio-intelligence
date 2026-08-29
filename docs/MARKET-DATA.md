# Market data providers

ADR-005 ("market data vendor selection") is still open, for one reason:
**nobody has confirmed that a vendor actually returns data for SIX Swiss
(XSWX) and B3 (BVMF)**, as opposed to listing them on a marketing page.
`assertCoversRequiredExchanges` in `connectors/base.ts` makes that a hard
constraint — a provider missing either exchange is unusable here regardless of
how good it is elsewhere.

**Resolved 2026-08-29: EODHD, on evidence.** `npm run verify:provider eodhd`,
run in the production container against the live key, returned real closes
dated 2026-08-28 for Nestle (78.62 CHF, SIX) and for WEG and Petrobras (49.98
and 43.55 BRL, B3), with the US control passing. ADR-005 is closed.

One thing that result did **not** grant: `/api/screener`. EODHD entitles
endpoints separately, and the same key 403s there — which is what stock
discovery needs. See "Endpoints are entitled separately" below.

## Providers in the repo

| Provider | Key | Prices | Fundamentals | Notes |
|---|---|---|---|---|
| `stub` | no | synthetic | synthetic | Reproducible pseudo-random walk. Every row tagged `source: 'stub'`. |
| `stooq` | **no** | daily OHLCV | **none** | Free, no signup, no quota. Prices only. |
| `eodhd` | yes | **verified** | yes | **In use.** `/api/eod` confirmed on SIX and B3 2026-08-29; `/api/screener` is a separate entitlement and is not on the plan. |
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

## Endpoints are entitled separately

The most useful thing learned from closing ADR-005: **a working EODHD key does
not imply access to every EODHD endpoint.** The same token that returned SIX
and B3 closes 403s on `/api/screener`.

| Feature | Endpoint | Status on the current key |
|---|---|---|
| Daily refresh, prices | `/api/eod` | Working |
| Fundamentals | `/api/fundamentals` | Untested — probe before relying on it |
| **Stock discovery** | `/api/screener` | 403 on Basic — falls back to `exchange-symbol-list` |

**Resolved for the Basic plan.** `getSecurityUniverse` no longer depends on the
screener. It now prefers the richest source the plan allows and falls back:

1. **`/api/screener`** — ranked by market capitalisation. Best, but an
   All-World-Extended / All-In-One feature that 403s on smaller plans.
2. **`/api/exchange-symbol-list`** — ships with every plan including the free
   tier — plus one **`/api/eod-bulk-last-day`** call to rank the list by last
   close x volume. On the current Basic plan this second call returns 423, so
   the universe is unranked in practice today.
3. **`/api/exchange-symbol-list` alone**, unranked, with the limitation recorded
   on every record so the agent must disclose it.

A plan-limit status (402, 403, **423**) triggers a fallback on the required
call. Any other status there is a real fault and surfaces. The optional ranking
call degrades on *any* failure — see below.

### Measured against a live Basic plan

```
200  exchange-symbol-list     <- the universe source works
423  eod-bulk-last-day        <- undocumented; means "not on your plan"
403  screener                 <- the known Basic limit
```

**423 is not in EODHD's documentation.** It is what `/api/eod-bulk-last-day`
actually returns on a plan whose `/api/eod` and `/api/exchange-symbol-list`
calls both return 200. An implementation that treated only 403 as a plan limit
would rethrow it and fail discovery on a plan where discovery works — which is
exactly what the first version of this code did, until the endpoint was probed
for real.

Two lessons encoded in the code as a result:

- The plan-limit set is `{402, 403, 423}`, not `{403}`. 401 stays out of it: a
  rejected token is a real fault and must surface.
- **The optional ranking call swallows every failure.** Ranking is an
  enhancement; the symbol list is the requirement. Letting an unavailable
  optional endpoint take down a working universe is a failure mode worth
  designing out, not a status code worth enumerating. The degradation is not
  silent — every record carries `universe_ranking: 'unranked'`.

### Why the ranking is not optional

The symbol list carries no size field. Truncating it alphabetically to fit the
per-exchange limit drops Nestlé, Novartis, Roche and UBS off a Swiss universe
while keeping every company beginning with A — worse than useless for a quality
thesis, and it fails *silently*: the run looks successful and simply never
considers the large caps. Turnover is a coarse proxy for size, but it is a real
provider-supplied number and it keeps the large caps in.

### Preferred shares are kept on purpose

The asset-type filter is an exclusion list, not an allow-list of "Common
Stock". PETR4 — one of the largest names on B3 — is a *preferred* share, and
much of the Brazilian market is preferreds and units. Allow-listing common
stock only would have silently deleted the B3 large caps this system exists to
analyse.

`describeEodhdFailure` in `eodhd.ts` now distinguishes these at the point of
failure — a 403 says the token was accepted and the plan is the limit, a 401
says the token itself was rejected. The previous message was a bare status
code, which sent a reader hunting for a broken key that was working fine.

## The quoting trap

Railway stores variable values **verbatim** — no shell or dotenv parser strips
quotes. `.env.example` writes values quoted, which is right for a dotenv file
and wrong when pasted into Railway's UI.

`MARKET_DATA_PROVIDER='eodhd'` with literal quotes fails validation loudly and
takes the whole dashboard down: `/api/health` returns 503 and the healthcheck
never passes. `MARKET_DATA_API_KEY='...'` is worse — it **passes**
`z.string().min(1)`, then goes into the query string percent-encoded, and every
request fails as though the key were wrong.

Set both without quotes.
