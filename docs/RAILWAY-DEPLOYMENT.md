# Railway Deployment Runbook

## Topology

Create one Railway project and one environment with these resources:

```text
Internet -> dashboard (public Next.js)
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

## Repository and service settings

Connect all three application services to this repository with root directory
`/`. Set each service's Railway config file path:

| Service | Config file | Public domain |
|---|---|---|
| `dashboard` | `/railway.dashboard.json` | Yes |
| `agentic-api` | `/railway.agentic-api.json` | No |
| `agentic-worker` | `/railway.agentic-worker.json` | No |

The files select Railpack, build the correct workspace, run committed
migrations, define start commands and set health/restart policy. Both agentic
services may run the migration command concurrently; the migrator holds a
PostgreSQL advisory lock.

## Dashboard variables

```text
DATABASE_URL=${{dashboard-postgres.DATABASE_URL}}
SESSION_SECRET=<32+ random bytes>
MFA_ENCRYPTION_KEY=<different 32+ random bytes>
PUBLIC_APP_URL=https://<your-dashboard-domain>
AGENTIC_SYSTEM_API_KEY=<same 32+ random bytes on all three app services>
AGENTIC_SYSTEM_BASE_URL=http://${{agentic-api.RAILWAY_PRIVATE_DOMAIN}}:${{agentic-api.PORT}}
CRON_SECRET=<32+ random bytes if refresh-cron is enabled>
MARKET_DATA_PROVIDER=stub
WEB_SEARCH_PROVIDER=none
NODE_ENV=production
```

The browser never calls `agentic-api`. Only dashboard route handlers use its
private URL.

## Agentic API variables

```text
AGENTIC_DATABASE_URL=${{agentic-postgres.DATABASE_URL}}
AGENTIC_SYSTEM_API_KEY=<shared service secret>
AGENTIC_INTERNAL_BASE_URL=http://${{agentic-api.RAILWAY_PRIVATE_DOMAIN}}:${{agentic-api.PORT}}
NODE_ENV=production

BUCKET=${{agentic-artifacts.BUCKET}}
ENDPOINT=${{agentic-artifacts.ENDPOINT}}
REGION=${{agentic-artifacts.REGION}}
ACCESS_KEY_ID=${{agentic-artifacts.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{agentic-artifacts.SECRET_ACCESS_KEY}}
```

The API needs bucket credentials because it streams private reports. Railway
injects `PORT`; do not hard-code it.

## Agentic worker variables

```text
AGENTIC_DATABASE_URL=${{agentic-postgres.DATABASE_URL}}
AGENTIC_SYSTEM_API_KEY=<shared service secret>
OPENAI_API_KEY=<secret>
OPENAI_MODEL=gpt-5.6
OPENAI_REASONING_EFFORT=medium
DASHBOARD_IMPORT_URL=http://${{dashboard.RAILWAY_PRIVATE_DOMAIN}}:${{dashboard.PORT}}/api/integrations/agentic/import
AGENTIC_INTERNAL_BASE_URL=http://${{agentic-api.RAILWAY_PRIVATE_DOMAIN}}:${{agentic-api.PORT}}
AGENTIC_CALLBACK_MAX_ATTEMPTS=8
NODE_ENV=production

BUCKET=${{agentic-artifacts.BUCKET}}
ENDPOINT=${{agentic-artifacts.ENDPOINT}}
REGION=${{agentic-artifacts.REGION}}
ACCESS_KEY_ID=${{agentic-artifacts.ACCESS_KEY_ID}}
SECRET_ACCESS_KEY=${{agentic-artifacts.SECRET_ACCESS_KEY}}
```

The callback URL must reference the dashboard service's domain and port, not
the worker's own `$PORT`.

## First administrator

Temporarily add `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` and optionally
`INITIAL_ADMIN_NAME` to `dashboard`, then run:

```bash
npm run admin:create
```

Remove `INITIAL_ADMIN_PASSWORD` immediately afterward. The command is
idempotent and does not overwrite an existing password. The initial password
must be a unique passphrase between 15 and 128 characters. Sign in and enroll
an authenticator under **More → Account Security** before loading portfolio data.

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
DASHBOARD_INTERNAL_URL=http://${{dashboard.RAILWAY_PRIVATE_DOMAIN}}:${{dashboard.PORT}}
CRON_SECRET=<same dashboard cron secret>
```

## End-to-end verification

1. All pre-deploy migrations finish successfully.
2. Dashboard `/api/health` and agentic API `/health` return HTTP 200.
3. An unauthenticated dashboard request redirects to `/login`; an
   unauthenticated agentic `/v1/**` call returns HTTP 401.
4. The login response contains CSP, HSTS, `nosniff`, `DENY` framing and
   `Cache-Control: no-store`; six failed account attempts produce HTTP 429.
5. Enroll MFA, sign out, and confirm that password-only login receives an MFA
   challenge and a used TOTP cannot be replayed.
6. Upload a thesis PDF, wait for extraction, review ambiguities and confirm it.
7. Start “Analyze current portfolios”; observe queued -> running -> imported.
8. Verify every requested holding has one analysis and every portfolio has one
   synthesis.
9. Open the proxied PDF while authenticated.
10. Replay the same callback and verify idempotency; alter the manifest and
   verify HTTP 409.
11. Confirm neither service log contains a bearer key, raw thesis document or
   raw provider payload.
