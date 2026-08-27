# Agentic API and Worker

This workspace is the reasoning half of Portfolio Intelligence. It runs as two
private Railway services from the same build:

- `agentic-api`: authenticated run/extraction/status/report HTTP endpoints;
- `agentic-worker`: durable PostgreSQL queue consumer, OpenAI calls, validation,
  PDF generation, bucket upload and dashboard callback delivery.

Both processes use the same `AGENTIC_DATABASE_URL`. This database is separate
from the dashboard database. The only dashboard write boundary is the
authenticated manifest callback.

## Single-model policy

Every language-model operation uses the OpenAI Responses API through
`OpenAIAgenticPipeline`. Thesis extraction, per-security analysis and portfolio
synthesis all use `OPENAI_MODEL` (default `gpt-5.6`). There is no Anthropic
adapter, voting layer, manager model or provider fallback.

## Local commands

```bash
npm run build:agentic
npm run agentic:migrate
npm run agentic:api
npm run agentic:worker
npm run test:agentic
```

The API listens on `0.0.0.0:$PORT`. Every `/v1/**` route requires
`Authorization: Bearer $AGENTIC_SYSTEM_API_KEY`; `/health` is intentionally
unauthenticated for Railway health checks.

## Endpoints

```text
POST /v1/thesis-extractions
GET  /v1/thesis-extractions/{externalExtractionId}
POST /v1/thesis-extractions/{externalExtractionId}/retry

POST /v1/analysis-runs
GET  /v1/analysis-runs/{externalRunId}
POST /v1/analysis-runs/{externalRunId}/retry
GET  /v1/analysis-runs/{externalRunId}/report
GET  /health
```

Start calls return HTTP 202 after the durable job row exists. The worker claims
jobs with `FOR UPDATE SKIP LOCKED`, renews the lease after each stage and never
returns a successful manifest if any requested security is missing. Callback
delivery uses bounded exponential retry without creating a second run.

## Artifacts

Production requires a private S3-compatible Railway bucket. Configure either
the `AGENTIC_BUCKET_*` variables or Railway's bucket variables (`BUCKET`,
`ENDPOINT`, `REGION`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`). Development and
tests fall back to PostgreSQL `bytea`; production refuses to start without the
bucket.

Reports are real PDFKit documents using bundled Inter fonts. The API reads the
private object and streams it to the dashboard, which in turn proxies it to an
authenticated browser.
