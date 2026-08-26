# Railway Deployment Runbook

## Service topology

```text
Internet -> dashboard (public Next.js)
              |-- Railway PostgreSQL
              |-- private HTTP -> agentic-system
              `-- private HTTP <- refresh-cron
```

The agentic service and its workers/storage remain independently owned. See
`AGENTIC-SYSTEM-HANDOFF.md`.

## Dashboard service

Create a Railway service from the repository root. In Railway service settings,
configure:

- builder: Railpack (the default)
- build command: `npm run build`
- pre-deploy command: `npm run db:migrate`
- start command: `npm run start:standalone`
- health check: `/api/health` with a 300-second timeout
- restart policy: On Failure, at most 10 retries

Railway's legacy `railway.toml` Config as Code is deprecated and unavailable to
new services. Once the Railway project exists, use `railway config init` or
`railway config pull` if you want to manage the complete project with the
current `.railway/railway.ts` Infrastructure as Code workflow. Do not apply an
incomplete project definition: omitted resources can be treated as deletions.

Configure:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=<32+ random characters>
AGENTIC_SYSTEM_BASE_URL=http://${{agentic-system.RAILWAY_PRIVATE_DOMAIN}}:${{agentic-system.PORT}}
AGENTIC_SYSTEM_API_KEY=<same 32+ character secret on both services>
CRON_SECRET=<32+ random characters>
MARKET_DATA_PROVIDER=stub
WEB_SEARCH_PROVIDER=none
```

Private Railway DNS is runtime-only. The Next.js build must not contact the
agentic service.

## First administrator

Temporarily configure `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` and
optionally `INITIAL_ADMIN_NAME`, then run this one-off command against the
dashboard service:

```bash
npm run admin:create
```

Remove `INITIAL_ADMIN_PASSWORD` afterward. The command is idempotent and does
not overwrite an existing password.

## Optional demo data

With the same initial-admin variables present, run `npm run seed`. Never run the
stub seed against a database already containing real portfolio data.

## Market refresh cron

Create a second service from the same repository with start command
`npm run cron:refresh`. Configure
`DASHBOARD_INTERNAL_URL=http://${{dashboard.RAILWAY_PRIVATE_DOMAIN}}:${{dashboard.PORT}}`
using a Railway reference variable and share the same `CRON_SECRET`. Set the
Railway cron schedule to `0 21 * * 1-5` UTC or a schedule appropriate for the
tracked exchanges.

## Deployment verification

1. Pre-deploy migration succeeds.
2. `/api/health` returns HTTP 200 and `database: reachable`.
3. An unauthenticated dashboard request redirects to `/login`.
4. Login creates an HttpOnly, Secure, SameSite=Lax cookie in production.
5. A user can only query rows carrying their owner ID.
6. The dashboard can start and poll an agentic run over the private network.
7. The agentic callback imports once and rejects a changed duplicate.
8. The dashboard report proxy streams the PDF to an authenticated user.
