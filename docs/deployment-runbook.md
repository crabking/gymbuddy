# COACH deployment runbook

The operational source of truth is `ops/environments.json`. It contains only
non-secret Coolify identifiers, branches, URLs, and health paths. Store secrets
in the matching Coolify environment.

## Preflight

1. Confirm the branch, clean commit, target app UUID, and target URL.
2. Confirm the database UUID is unique to the environment.
3. Confirm `APP_ENV`, `PUBLIC_ORIGIN`, and trusted-proxy behavior.
4. Verify a current backup before a destructive production migration.
5. Run tests, lint, build, dependency audit, and local browser regression.

## Authentication

Public environments use Better Auth:

- `AUTH_PROVIDER=better-auth`
- `VITE_AUTH_PROVIDER=better-auth`
- unique runtime-only `BETTER_AUTH_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`
- optional runtime-only `SMTP_USER` and `SMTP_PASSWORD`
- matching server/browser public-signup switches

The two `VITE_*` switches are public and must be exposed at build time as well
as runtime in Coolify. All secrets remain runtime-only.

The auth route is `/api/auth/*`. Test verified signup, sign-in, recovery,
seven-day sessions, authenticator-app 2FA, session revocation, and deletion in
each environment. Existing users retain their UUID and scrypt password hash but
must create a new browser session after migration.

## Stripe

Keep `BILLING_PROVIDER=disabled` until the target environment has:

- its own Stripe mode/resources and monthly/annual recurring prices;
- `/api/auth/stripe/webhook` registered with its own webhook secret;
- Stripe Tax registrations and automatic tax configured;
- customer portal cancellation/invoice behavior configured;
- the readiness acknowledgements in `.env.example` set to true.

Use Stripe test mode in staging and live mode only in production. Verify
checkout, success/cancel returns, webhook replay, portal access, cancellation,
and subscribed-account deletion. Never store card data in COACH.

## Private analytics

Configure a unique runtime-only `ANALYTICS_HASH_SECRET`, at least one email in
`ANALYTICS_ADMIN_EMAILS`, `ANALYTICS_TIMEZONE`,
`ANALYTICS_RETENTION_DAYS`, and the current AI input/output token rates.
Production dashboard access requires an allowlisted Better Auth administrator
with MFA. The dashboard is read-only and queries server-side aggregates; never
put a production database URL in browser code or connect a localhost browser
directly to the live database.

After deployment, verify that an allowlisted admin can load
`/admin-analytics`, a regular account gets no data, funnel events are
idempotent, Stripe webhook replay does not duplicate revenue, AI failures are
counted without prompts/responses, and expired analytics records are removed.
Keep payment-accounting retention separate from product analytics retention.
Cloudflare Access can be added as a second perimeter control, but must not
replace app authorization.

## Deployment

Staging tracks `codex/staging` and auto-deploys on GitHub push. Production
tracks `main` but deployment is explicit through Coolify. The container runs
SQL migrations under an advisory lock, verifies database environment
ownership, optionally refreshes seeded credentials, and starts on port 3000.

Verify `/api/health`, `/api/readiness`, the deployed commit, authentication,
chat, program, workout persistence, nutrition, account export/deletion, and PWA
installation. Roll application regressions back to a known-good commit. Prefer
a forward database repair; restore only after isolating writes and validating
the exact environment.
