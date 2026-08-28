# Cybersecurity Baseline

This implementation translates the supplied *Cybersecurity for Websites:
Protection Mechanisms and Real-World Examples* PDF into controls appropriate
for this Railway-hosted application. The PDF is treated as a requirements
baseline; implementation choices follow current OWASP guidance and the actual
Next.js/PostgreSQL architecture.

## Implemented controls

| PDF theme | Application control | Verification |
|---|---|---|
| Strong authentication | Email/password login, 15–128 character enrollment policy, common-password rejection, generic failure messages | `tests/auth-integration.test.ts` and `/login` |
| Secure password storage | Per-user salt and scrypt `N=2^17, r=8, p=1`; legacy hashes are accepted and upgraded after a qualifying login | `src/lib/password.ts` |
| Two-factor authentication | Optional RFC-compatible TOTP, encrypted seed, ten one-time recovery codes, replay prevention | `/account/security` and `src/lib/totp.ts` |
| Brute-force protection | Account and network limits persisted in PostgreSQL; HTTP 429 and `Retry-After` during a 15-minute block | `authentication_rate_limits` |
| Session protection | Signed random token, only its digest stored, revocation, 7-day absolute/8-hour idle expiry, `HttpOnly`, `Secure` in production, `SameSite=Lax` | `user_sessions` and `src/lib/auth.ts` |
| CSRF protection | Same-origin `Origin` plus Fetch Metadata validation on browser mutations; `PUBLIC_APP_URL` pins the canonical origin | `assertSameOrigin()` |
| Injection/XSS defense | Zod input bounds, Drizzle parameterized queries, React escaping, CSP, `nosniff`, no framing | route schemas and `next.config.ts` |
| Document upload safety | Stream-bounded JSON, 10 MB PDF/2 MB text caps, strict encoding, type signatures, UTF-8 checks and active-PDF rejection at both services | `document-security.ts` and agentic HTTP tests |
| Monitoring | Append-only auth events containing HMAC identifiers rather than raw email, IP or user-agent values | `authentication_events` |
| Patch management | Next.js and Drizzle upgraded past known high advisories; weekly Dependabot and CI `npm audit` | `.github/` |
| Encryption in transit | HTTPS redirect for public page traffic and HSTS; Railway/Cloudflare terminate TLS | `src/proxy.ts` and edge checklist below |

The dashboard never stores plaintext passwords, authenticator seeds, recovery
codes, session tokens, API keys, raw IP addresses or raw user-agent strings.
The TOTP seed is AES-256-GCM ciphertext under `MFA_ENCRYPTION_KEY`; recovery
codes and audit identifiers use domain-separated HMAC keys.

The PDF checks are a strict ingestion gate, not an antivirus engine: compressed
or novel malicious structures can evade string-level inspection. Documents are
never executed or rendered by either service. Add a managed malware-scanning
step before external model handoff if uploads will be accepted from untrusted
third parties.

## Required Railway and Cloudflare controls

Source code cannot provide a volumetric DDoS network or inspect requests before
they reach Railway. Complete these deployment actions before production:

1. Route the public custom domain through Cloudflare and keep the dashboard's
   Railway-generated hostname out of user-facing links.
2. Set SSL/TLS mode to **Full (strict)**, enable TLS 1.3 and Always Use HTTPS.
3. Enable the Cloudflare Managed Ruleset and OWASP Core Ruleset. Begin in log
   mode, review false positives, then block high-confidence attacks.
4. Add an edge rule for `POST /api/auth/session`: challenge abnormal bursts and
   block sustained abuse. Retain the database rate limiter as defense in depth.
5. Enable Cloudflare DDoS alerts and Railway service/database alerts. Send them
   to an actively monitored channel.
6. Keep `agentic-api`, `agentic-worker`, both PostgreSQL services and the
   artifact bucket private. The agentic bearer key remains mandatory even on
   Railway's private network.
7. Configure `PUBLIC_APP_URL`, a unique `SESSION_SECRET`, a different
   `MFA_ENCRYPTION_KEY`, and all service credentials through Railway variables.
   Never place production secrets in Git.
8. Encrypt and test PostgreSQL backups. Keep generated reports in a private
   bucket and serve them only through the authenticated dashboard proxy.

Cloudflare WAF documentation: <https://developers.cloudflare.com/waf/>

Cloudflare TLS 1.3 documentation: <https://developers.cloudflare.com/ssl/edge-certificates/additional-options/tls-13/>

## Password and account operations

- Provision the first owner through the conditional dashboard pre-deploy
  bootstrap, then immediately remove all `INITIAL_ADMIN_*` Railway variables.
- Use a password manager-generated passphrase that is unique to this service.
- Enroll MFA at **More → Account Security** and store recovery codes offline.
- Changing the password or MFA state revokes every other active session.
- Disabled users cannot authenticate, even with an unexpired signed cookie.
- Back up `MFA_ENCRYPTION_KEY` in the approved secret manager. Do not rotate it
  blindly: an intentional rotation requires clearing existing encrypted seeds,
  revoking sessions and requiring every affected user to enroll MFA again.

There is intentionally no email-based password reset yet: a partial reset flow
is more dangerous than an explicit administrator recovery procedure. Until a
verified mail provider and single-use reset-token flow are implemented, recover
an owner through an audited database/administrative procedure and immediately
rotate sessions.

## Monitoring and response

Review `authentication_events` for repeated failures, blocks, MFA changes and
password changes. Alert on unusual failure volume and any administrative
security change. Retain only as long as the security policy requires, because
even pseudonymous telemetry is sensitive. The protected daily refresh removes
expired throttle rows after 24 hours and authentication events after 180 days;
change that retention only through an approved data-retention policy.

For a suspected compromise:

1. Disable the affected user and revoke their `user_sessions`.
2. Rotate `SESSION_SECRET` to invalidate every browser session when the scope is
   uncertain.
3. Rotate `AGENTIC_SYSTEM_API_KEY`, OpenAI and storage credentials if service
   access may be involved.
4. Preserve relevant application, Railway, Cloudflare and PostgreSQL logs.
5. Determine the entry path, patch it, restore from verified backups if needed,
   and require new passwords/MFA enrollment before reactivation.

## Routine verification

Run before each release:

```bash
npm ci
npm audit --omit=dev --audit-level=moderate
npm audit --audit-level=high
npm run typecheck
npm test
npm run build
```

After deployment, verify login throttling, MFA enrollment/login/replay rejection,
logout, password change, other-session revocation, security response headers,
database backups and a complete agentic run. Schedule an independent penetration
test before storing real financial data and after material authentication or
network changes.

At implementation time, the production dependency audit is clear and the full
tree has no high or critical advisories. The stable Drizzle migration CLI still
pulls four moderate, development-only `esbuild` advisories through its retired
loader package. That CLI is not shipped in the standalone runtime and must never
be exposed as a network service. Dependabot tracks the upstream stable fix; a
pre-release Drizzle CLI was intentionally not introduced into production
migration tooling merely to silence the report.

Primary implementation references:

- OWASP Authentication Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- OWASP Password Storage Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- OWASP Multifactor Authentication Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html>
- OWASP Session Management Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- OWASP HTTP Headers Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html>
- OWASP CSRF Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
