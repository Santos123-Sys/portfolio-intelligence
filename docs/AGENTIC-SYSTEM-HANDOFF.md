# Agentic Layer Implementation Handoff

Copy this document into the LLM implementing the agentic service. It is the
integration contract with the completed dashboard layer.

## 1. Repository boundary

You own **only** `services/agentic/**` in `Santos123-Sys/portfolio-intelligence`.
Do not modify `src/**`, `scripts/**`, `drizzle/**`, `docs/**`, root deployment
configuration, or dashboard dependencies. If the contract needs revision,
describe the proposed change without editing dashboard-owned files.

## 2. Service responsibility

Implement thesis extraction, deterministic grounding preparation, one analysis
call per security, portfolio synthesis, PDF rendering, artifact storage and run
status. Do not implement dashboard pages, dashboard authentication, portfolio
mutations or database writes into dashboard tables.

## 3. Deployment model

Deploy as a private Railway service named `agentic-system` in the same Railway
project and environment as the dashboard. Listen on `0.0.0.0:$PORT`. The service
does not need a public domain.

## 4. Service authentication

Require `Authorization: Bearer <AGENTIC_SYSTEM_API_KEY>` on every `/v1/**`
endpoint. Use the same secret configured on the dashboard; require at least 32
random characters. Never return or log the credential.

## 5. Start-run endpoint

Implement `POST /v1/analysis-runs`. Validate and accept:

```json
{
  "thesis": {
    "versionId": "dashboard-thesis-version-uuid",
    "criteria": { "version": 1, "portfolios": [], "globalConstraints": [] }
  },
  "securities": [
    { "ticker": "NESN", "exchange": "XSWX", "portfolioId": "dashboard-portfolio-uuid" }
  ],
  "portfolios": [
    {
      "id": "dashboard-portfolio-uuid",
      "name": "Swiss Quality",
      "baseCurrency": "CHF",
      "investmentObjective": "Capital preservation and compounding"
    }
  ]
}
```

Respond with HTTP 202 and:

```json
{ "externalRunId": "stable-unique-id", "status": "queued", "updatedAt": "ISO-8601" }
```

## 6. Run-status endpoint

Implement `GET /v1/analysis-runs/{externalRunId}`. Return the same stable ID and
one status from `queued | running | completed | failed`. A failed run includes a
non-empty `errorMessage`. A completed run may include `reportPdfUrl` and the
validated manifest.

## 7. Report endpoint

Implement `GET /v1/analysis-runs/{externalRunId}/report`. Stream the generated
PDF with `Content-Type: application/pdf`. The dashboard proxies this endpoint to
the authenticated browser; therefore the artifact itself does not need a public
URL.

## 8. Completion callback

Configure this variable on the `agentic-system` Railway service using a Railway
reference variable (do not substitute the agentic service's own `$PORT`):

```text
DASHBOARD_IMPORT_URL=http://${{dashboard.RAILWAY_PRIVATE_DOMAIN}}:${{dashboard.PORT}}/api/integrations/agentic/import
```

After durable completion, call the dashboard over Railway private networking:

```text
POST $DASHBOARD_IMPORT_URL
Authorization: Bearer <AGENTIC_SYSTEM_API_KEY>
Content-Type: application/json
```

Use plain HTTP on the private network. Never hard-code the dashboard host or
port.

## 9. Completed callback body

```json
{
  "externalRunId": "same-id-returned-at-start",
  "status": "completed",
  "manifest": {
    "schemaVersion": "1.0",
    "generatedAt": "ISO-8601",
    "thesisVersion": 1,
    "portfolios": []
  },
  "reportPdfUrl": "optional-internal-or-signed-url"
}
```

The dashboard rejects an unknown run ID, a manifest with another user's
portfolio IDs, an unrequested ticker/exchange, or reuse of a run ID with a
different manifest hash.

## 10. Failed callback body

```json
{
  "externalRunId": "same-id-returned-at-start",
  "status": "failed",
  "errorMessage": "safe operational explanation"
}
```

Do not include stack traces, prompts, credentials or provider payloads in the
error message.

## 11. Analysis schema

Every security analysis must contain: `ticker`, `companyName`,
`portfolioCandidate`, `portfolioRole`, `investmentScore`,
`thesisAlignmentScore`, `qualityScore`, `growthScore`, `riskScore`,
`dividendScore`, `fundamentalSummary`, `investmentThesis`, `keyCatalysts`,
`keyRisks`, `thesisBreakers`, `confidenceScore`, `groundedIn`, and
`informationGaps`. Scores are integers from 0–100; confidence is 0–1; risk is
0=safest and 100=riskiest.

## 12. Synthesis schema

Every portfolio result must contain `executiveSummary`, `thematicHighlights`,
`concentrationFlags`, `perSecurityNarratives`, `watchlistAndViolations`,
`disclaimer`, and a non-empty `groundedIn` ticker list. Cover every input
security exactly once in `perSecurityNarratives`.

## 13. Deterministic boundaries

Agents may interpret supplied metrics but must never calculate returns, ratios,
weights, volatility, Sharpe, VaR, covariance or risk contributions. Every claim
must reference a supplied field in `groundedIn`; missing values belong in
`informationGaps`.

## 14. Idempotency and durability

`externalRunId` is globally unique and immutable. Repeated status reads and
callbacks must be safe. Persist status before replying to start requests,
persist artifacts before sending the completed callback, and retry callbacks
with bounded exponential backoff. Never generate a second logical run while
retrying delivery.

## 15. Storage and database isolation

Use your own agentic-service database/queue and Railway bucket. Do not connect
with dashboard database credentials and do not write directly to dashboard
tables. The HTTP manifest contract is the only write boundary between systems.

## 16. Acceptance tests

Prove: authenticated start returns 202; unauthenticated calls return 401; status
transitions are valid; completed and failed callbacks work; duplicate callbacks
are idempotent; changed manifests under one run ID are rejected; every requested
ticker appears exactly once; fabricated grounding references fail validation;
PDF endpoint streams a valid PDF; logs contain no credentials or raw portfolio
documents.
