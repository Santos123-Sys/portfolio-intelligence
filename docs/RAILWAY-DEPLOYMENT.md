# Railway Deployment Runbook

## Topology

Create one Railway project and one environment with these resources:

```text
Internet -> portfolio-intelligence (public Next.js dashboard)
              |-- dashboard-postgres
              |-- private HTTP -> agentic-api
              `-- optional refresh-cron

agentic-api <-> agentic-postgres <-> agentic-worker -> OpenAI
      |                                  |
      `---------- agentic-artifacts -----'
                         |
agentic-worker --private callback--> dashboard
```

`dashboard-postgres` and `agentic-postgres` must remain distinct. Private
networking is transport, not authorization: the shared service bearer key is
required on every `/v1/**` request and on the callback.

## Repository and infrastructure definition

The current deployment source is `.railway/railway.ts`, using Railway's
project-level Infrastructure as Code API. It declares:

| Resource | Purpose | Public domain |
|---|---|---|
| `portfolio-intelligence` | Next.js dashboard | Existing generated/custom domain only |
| `agentic-api` | Authenticated run and report API | No |
| `agentic-worker` | Durable OpenAI job processor and callback delivery | No |
| `dashboard-postgres` | Dashboard-owned records and authentication | No |
| `agentic-postgres` | Agentic jobs, leases and callback state | No |
| `agentic-artifacts` | Private PDF reports | No |

All application services use the GitHub repository
`Santos123-Sys/portfolio-intelligence`, branch `main`, and root directory `/`.
The definition selects Railpack, builds the correct workspace, runs committed
migrations, defines start commands and sets health/restart policy. Both agentic
services may run the migration command concurrently; the migrator holds a
PostgreSQL advisory lock.

Railway's former per-service Config as Code is deprecated. The root
`railway.dashboard.json`, `railway.agentic-api.json` and
`railway.agentic-worker.json` files are temporary migration compatibility files;
do not attach them to new services. The existing dashboard's custom Config File
Path must be cleared before Railway IaC can manage it.

## Safe live-project migration

Infrastructure as Code is declarative: an omitted resource can be deleted.
Never apply this file to an existing project without reconciling a plan first.

1. In the Railway web dashboard, add a project/environment shared variable named
   `OPENAI_API_KEY`. Enter the real OpenAI API key there; never put it in Git or
   this document.
2. Add a second shared secret named `MARKET_DATA_API_KEY` containing an EODHD
   token whose plan includes the global Screener, End-of-Day history and
   Fundamentals APIs. Discovery is intentionally disabled when only stub data
   is configured.
3. Confirm the existing public service is named `portfolio-intelligence`. If it
   has a different name, update `.railway/railway.ts` before planning.
4. Confirm its generated public URL is
   `https://portfolio-intelligence-production-d042.up.railway.app`, or update
   `PUBLIC_APP_URL` in `.railway/railway.ts` to the active HTTPS origin.
5. Preserve the existing dashboard `SESSION_SECRET` and
   `MFA_ENCRYPTION_KEY`. The IaC definition deliberately uses `preserve()` for
   these values so applying infrastructure cannot invalidate sessions or stored
   MFA seeds.
6. Clear the dashboard service's deprecated Config File Path in **Settings**.
   Do not trigger a deployment between clearing it and completing the IaC plan.
7. Using Railway CLI 5.42.1 or newer from an authenticated operator session,
   link the existing project and run `railway config plan`. Planning is
   read-only. The intended plan may add the two named PostgreSQL resources,
   `agentic-api`, `agentic-worker` and `agentic-artifacts`; it must not delete or
   replace the existing dashboard or any database containing data.
8. Stop if the plan contains an unexpected destroy, service replacement, domain
   removal or database replacement. Re-import/reconcile the live names before
   proceeding.
9. Apply only the reviewed plan. The person using the web application does not
   need Railway CLI or SSH; CLI access is only an infrastructure-operator step.

The repository can prepare and validate the desired state, but Railway still
requires an authenticated project account or scoped project token before a live
plan or apply can occur.

## Dashboard variables

`.railway/railway.ts` manages `DATABASE_URL`, `PUBLIC_APP_URL`, the private
agentic URL, the generated shared bearer key, provider modes and `NODE_ENV`.
It binds the project-level `MARKET_DATA_API_KEY` to the dashboard and selects
`MARKET_DATA_PROVIDER=eodhd`; the token is never sent to the browser or agentic
services.
It preserves the existing `SESSION_SECRET`, `MFA_ENCRYPTION_KEY` and temporary
`INITIAL_ADMIN_*` values. Before the first IaC apply, verify both preserved
security keys already contain different random values of at least 32
characters. `CRON_SECRET` remains optional and is configured only if the refresh
cron is enabled.

The browser never calls `agentic-api`. Only dashboard route handlers use its
private URL.

## Agentic API variables

The IaC definition supplies `AGENTIC_DATABASE_URL`, a generated sealed
`AGENTIC_SYSTEM_API_KEY`, the private base URL, `NODE_ENV` and all five
`AGENTIC_BUCKET_*` references. Do not copy bucket credentials into the dashboard
or expose this service publicly.

The API needs bucket credentials because it streams private reports. Railway
injects `PORT`; do not hard-code it.

## Agentic worker variables

The IaC definition supplies the agentic database, bearer key, model settings,
private callback/API URLs, retry/lease settings and bucket references. The only
manual worker secret is the project-level shared `OPENAI_API_KEY`.

The callback URL must reference the dashboard service's domain and port, not
the worker's own `$PORT`.

## First administrator

Temporarily add `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` and optionally
`INITIAL_ADMIN_NAME` to `portfolio-intelligence`, then deploy. The dashboard
pre-deploy step runs migrations followed by the conditional owner bootstrap
automatically:

```bash
npm run db:migrate && npm run admin:create:if-configured
```

No Railway CLI or SSH session is required. A deployment with neither credential
variable skips the bootstrap; a partial configuration fails safely. Remove all
three `INITIAL_ADMIN_*` variables immediately after the deployment reports
`Created initial administrator ...`. The command is idempotent and does not overwrite
an existing password. The initial password must be a unique passphrase between
15 and 128 characters. Sign in and enroll an authenticator under **More →
Account Security** before loading portfolio data.

## Public edge protection

Put the production custom domain behind Cloudflare, enable TLS 1.3, use Full
(strict) certificate validation, turn on the Cloudflare and OWASP managed WAF
rulesets, and add an edge rate-limit/challenge rule for `/api/auth/session`.
Application-level throttling still applies if the edge is bypassed. Do not
expose either agentic service publicly.

See `docs/CYBERSECURITY.md` for the complete control map, verification commands,
logging rules and response checklist.

## Optional refresh cron

Create a service from the same repository with start command
`npm run cron:refresh`, no public domain, and a Railway cron schedule such as
`0 21 * * 1-5` UTC. Configure:

```text
DASHBOARD_INTERNAL_URL=http://${{portfolio-intelligence.RAILWAY_PRIVATE_DOMAIN}}:${{portfolio-intelligence.PORT}}
CRON_SECRET=<same dashboard cron secret>
```

## End-to-end verification

1. All pre-deploy migrations finish successfully.
2. Dashboard `/api/health`, agentic API `/health` and agentic worker `/health`
   return HTTP 200. The worker endpoint answers 503 while it has not polled the
   job queue within its budget, so a wedged worker fails its healthcheck instead
   of reporting Online while jobs pile up behind it.
3. An unauthenticated dashboard request redirects to `/login`; an
   unauthenticated agentic `/v1/**` call returns HTTP 401.
4. The login response contains CSP, HSTS, `nosniff`, `DENY` framing and
   `Cache-Control: no-store`; six failed account attempts produce HTTP 429.
5. Enroll MFA, sign out, and confirm that password-only login receives an MFA
   challenge and a used TOTP cannot be replayed.
6. Upload a thesis PDF, wait for extraction, review ambiguities and confirm it.
   Confirmation must create a market-research run automatically and redirect to
   **AI Stock Discovery**. A blocked transition must name the missing provider,
   portfolio or agentic-service prerequisite without undoing the confirmed
   thesis.
7. Open **More -> Portfolio Setup**, create each portfolio, and add at least one
   holding to every portfolio. The Agentic System button remains disabled until
   the readiness panel reports no missing prerequisites.
8. Start “Analyze current portfolios”; observe queued -> running -> imported.
9. Verify every requested holding has one analysis and every portfolio has one
   synthesis.
10. Open the proxied PDF while authenticated.
11. Replay the same callback and verify idempotency; alter the manifest and
   verify HTTP 409.
12. Confirm neither service log contains a bearer key, raw thesis document or
    raw provider payload.
13. On **AI Stock Discovery**, observe the provider-backed run started by thesis
    confirmation. Approve one candidate and verify that only that candidate
    starts a financial analysis. Confirm that the manual start control remains
    a recovery path and that no portfolio position is created.
14. Review the standalone risk methods, confirm DCF assumptions, and verify the
    fair-value scenario includes methodology, evidence references and caveats.
