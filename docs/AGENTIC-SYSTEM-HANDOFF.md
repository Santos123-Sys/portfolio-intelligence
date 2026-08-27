# Integrated Agentic System Contract

This document records the implemented boundary between the dashboard and the
agentic API/worker. The components now live in one repository and deploy as
separate Railway processes.

## 1. Repository layout

```text
packages/agentic-contract/  shared strict schemas and validators
services/agentic/           private API, worker, OpenAI pipeline, PDF, storage
src/                        dashboard, deterministic engine and import adapter
```

## 2. Ownership boundary

The dashboard owns users, confirmed theses, portfolios, positions, calculations,
grounding construction, result import and human decisions. The agentic service
owns extraction, interpretation, synthesis, run state and reports. It never
connects to the dashboard database or executes a trade.

## 3. Single-model pipeline

`OpenAIAgenticPipeline` runs three logical stages with the same `OPENAI_MODEL`:

1. thesis extraction;
2. one security analysis per requested holding;
3. one synthesis per requested portfolio.

No other model provider, voting model or manager layer exists.

## 4. Authentication

Every `/v1/**` endpoint requires:

```text
Authorization: Bearer <AGENTIC_SYSTEM_API_KEY>
```

The dashboard import callback requires the same credential. `/health` is public
only so Railway can perform health checks.

## 5. Thesis extraction

```http
POST /v1/thesis-extractions
GET /v1/thesis-extractions/{externalExtractionId}
POST /v1/thesis-extractions/{externalExtractionId}/retry
```

The start body is `{ "document": { "version", "fileName", "mimeType",
"contentBase64" } }`. PDF, text and Markdown are supported up to 50 MB. A
completed result includes criteria, extraction confidence, ambiguous points and
unmapped content. The dashboard requires explicit human confirmation before it
creates a canonical `thesis_versions` row.

## 6. Start analysis

```http
POST /v1/analysis-runs
```

The browser sends only an optional portfolio/thesis selection to the dashboard.
The dashboard server constructs the full request from owner-scoped canonical
records:

```json
{
  "thesis": { "versionId": "uuid", "criteria": {} },
  "securities": [{ "ticker": "NESN", "exchange": "XSWX", "portfolioId": "uuid" }],
  "portfolios": [{ "id": "uuid", "name": "Swiss Quality", "baseCurrency": "CHF", "investmentObjective": "..." }],
  "groundingBundles": [{ "portfolioId": "uuid", "bundle": { "computedMetrics": {}, "fundamentals": {} } }]
}
```

The service persists the job before returning HTTP 202 with a globally unique,
immutable `externalRunId` and `status: "queued"`.

## 7. Status and retry

```http
GET  /v1/analysis-runs/{externalRunId}
POST /v1/analysis-runs/{externalRunId}/retry
```

Statuses are `queued | running | completed | failed`. Running responses include
completed/total/current-stage progress. Failed responses include a safe message.
Retry keeps the same logical run ID.

## 8. Grounding rules

Every analysis reference must exactly equal a key supplied in
`computedMetrics` or `fundamentals`. Fuzzy aliases and fabricated references are
rejected. The agent may interpret values but may not calculate returns, weights,
ratios, volatility, Sharpe, VaR, covariance or risk contribution. Missing
evidence must appear in `informationGaps`.

## 9. Analysis validation

All six scores are integers from 0 to 100; confidence is from 0 to 1; risk is
0=safest and 100=most severe. `groundedIn`, catalysts, risks and thesis breakers
are non-empty. An alignment score below 45 caps the investment score at alignment
+ 15. The investment thesis must label both the affirmative case and strongest
counter-case.

## 10. Synthesis validation

Each requested ticker appears exactly once in `perSecurityNarratives` and the
synthesis cannot cite another ticker. The model cannot re-score or soften a
security. Concentration statements can use only supplied position weights;
watchlist/violation statements can use only candidate flags and thesis breakers.

## 11. Manifest and idempotency

Completed output conforms to `PortfolioAnalysisManifest` schema version `1.0`.
It includes every requested portfolio and security, the original thesis version,
generation time, analyses and syntheses. Hashes use canonical key ordering. The
dashboard accepts a duplicate callback with the same hash and rejects reuse of a
run ID with different content.

## 12. PDF endpoint and artifact location

```http
GET /v1/analysis-runs/{externalRunId}/report
Content-Type: application/pdf
```

Production PDF bytes are stored at
`s3://<agentic-artifacts>/reports/{externalRunId}.pdf` in the private Railway
bucket. The agentic API streams the object to the dashboard, which proxies it to
the authenticated browser. No public bucket URL is required.

## 13. Dashboard callback

```http
POST /api/integrations/agentic/import
Authorization: Bearer <AGENTIC_SYSTEM_API_KEY>
```

Completed body:

```json
{ "externalRunId": "...", "status": "completed", "manifest": {}, "reportPdfUrl": "optional private URL" }
```

Failed body:

```json
{ "externalRunId": "...", "status": "failed", "errorMessage": "safe explanation", "failedStage": "analysis" }
```

## 14. Durability

The worker claims PostgreSQL jobs with `FOR UPDATE SKIP LOCKED`, uses expiring
leases and persists artifacts before completion. Callback delivery retries with
bounded exponential backoff. A failed security or synthesis fails the entire run
instead of silently omitting data.

## 15. Database isolation

`DATABASE_URL` is dashboard-only. `AGENTIC_DATABASE_URL` is agentic-only. Bucket
credentials are present only on agentic API/worker services. The HTTP contract is
the sole cross-database write boundary.

## 16. Verification

Automated coverage proves schema, extraction edge cases, score gates, exact
grounding, synthesis coverage, stable manifest hashes, authentication, unique
run IDs, status/retry behavior, completed/failed callbacks, report streaming and
whole-run failure on a single-security error. The generated PDF is additionally
rendered with Poppler and inspected page by page.
