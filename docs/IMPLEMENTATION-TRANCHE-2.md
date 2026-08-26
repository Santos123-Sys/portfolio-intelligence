# Implementation Tranche 2 — Provider, Workflow, Quant & Auth

This tranche implements the next operational layer on top of the master investment-management specification.

## 1. Yahoo Finance / Provider Integration

The system now includes `MARKET_DATA_PROVIDER="yahoo-search"`.

The provider is intentionally search-mediated:

- It does not scrape Yahoo Finance pages.
- It does not call undocumented Yahoo Finance endpoints.
- It uses a configured web-search provider to discover Yahoo Finance result snippets.
- It extracts only conservatively parseable values.
- If no reliable value is present in the search result, it returns `DATA_UNAVAILABLE` rather than fabricating a price or fundamental metric.

Current search provider implementation:

- `WEB_SEARCH_PROVIDER="brave"`
- `WEB_SEARCH_API_KEY` for Brave Search API

Historical price bars are not fabricated from search snippets. Risk metrics continue to rely on persisted historical observations. If a 252-trading-day history does not exist, the quantitative layer must continue reporting insufficient/unstable data caveats.

## 2. Market/Fundamental Provenance

New table:

- `market_data_observations`

Each observation records:

- security
- observation type
- metric name
- numeric/text value
- currency
- observation date
- retrieval timestamp
- provider
- source name
- source URL
- search query
- status
- evidence snippet
- raw payload

This creates a durable audit trail from provider/search evidence into downstream prices, fundamentals, AI grounding and KPIs.

## 3. Thesis Upload / Version Mutation

`POST /api/thesis` now creates a new immutable thesis version.

Behavior:

- Requires mutation authorization.
- Accepts `rawDocument` and/or `criteriaJson`.
- Supersedes the latest active version.
- Inserts the new thesis version.
- Writes an audit record in `thesis_mutation_audit`.

## 4. Candidate Review Mutations

`POST /api/candidates` now supports human review decisions:

- `accepted`
- `rejected`
- `watchlist`
- `reanalysis_requested`

A `reanalysis_requested` decision creates a pending `analysis_jobs` record and links it through `candidate_reanalysis_requests`.

## 5. Quantitative Extensions

The deterministic quantitative engine now includes:

- Sortino ratio
- Beta to portfolio
- Covariance matrix persistence
- Herfindahl-Hirschman concentration index
- Component risk contribution
- Single-period position return contribution
- Total attributed return

These figures are persisted in `risk_metrics` with methodology and caveats. No AI calculates these metrics.

## 6. Authentication / Authorization Boundary

A temporary write boundary has been added:

- `MUTATION_API_KEY`
- accepted through `x-api-key` or `Authorization: Bearer <token>`

Read APIs remain public for preview. Write APIs now require the mutation secret in production.

This is not a final user-login system. Before real private portfolio data is stored, this must be replaced or extended with session-based authentication, user ownership checks and role-based authorization.

## 7. Required Database Push

The new schema tables require a database schema push before the new endpoints can run in the deployed environment:

```powershell
cd "C:\Users\Gustavo.DESKTOP-8QTINKB\Documents\portfolio-intelligence"
git checkout implement-master-spec
git pull
npm install
npm run db:push
```
