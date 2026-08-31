# Railway infrastructure

`railway.ts` is the project-level desired state for the production dashboard,
agentic API, worker, isolated databases and private report bucket.

Before any live apply:

1. Read `docs/RAILWAY-DEPLOYMENT.md`.
2. Add the shared `OPENAI_API_KEY` and `MARKET_DATA_API_KEY` in Railway without
   committing either value. `MARKET_DATA_API_KEY` must be an EODHD API token
   with access to the exchanges and fundamentals used by validation. Add
   `DISCOVERY_PROVIDER=finnhub` and `FINNHUB_API_KEY` directly to the dashboard
   only when the Finnhub key is ready. Add `WEB_SEARCH_PROVIDER=tavily` and
   `WEB_SEARCH_API_KEY` directly to `agentic-worker` only when the Tavily key
   is ready. Those four values are preserved by IaC rather than committed.
3. Verify the existing dashboard is named `portfolio-intelligence` and that the
   configured `PUBLIC_APP_URL` is its active HTTPS origin.
4. Clear the existing service's deprecated Config File Path.
5. Run a read-only `railway config plan` with Railway CLI 5.42.1 or newer.
6. Stop on any unexpected destroy, database replacement or domain removal.
7. Apply only a reviewed plan.

The web-application owner never needs Railway CLI or SSH. These commands are
only for an authenticated infrastructure operator. Secrets remain in Railway;
the definition contains only generators, preserved values and resource
references.
