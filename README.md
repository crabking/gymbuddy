# COACH

A mobile-first AI personal trainer that builds programs, coaches live workouts,
tracks nutrition and progress, and keeps account-scoped long-term memory.

**Stack:** TanStack Start, React 19, Vite, Tailwind, Postgres, Drizzle ORM,
Better Auth, Stripe Billing, Vercel AI SDK, and Nitro's Node server preset.
The application is self-hosted; Better Auth runs inside the COACH server and
does not introduce a hosted identity database.

## Local development

Requires Node 22+ and Docker.

```sh
npm install
cp .env.example .env
docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev
```

The local app is served at `http://localhost:8080`. The production site is an
installable PWA over HTTPS.

## Authentication

`AUTH_PROVIDER=local` is the invite-only development and rollback provider.
Public production uses `AUTH_PROVIDER=better-auth` and
`VITE_AUTH_PROVIDER=better-auth`.

Better Auth provides:

- verified email/password registration and password recovery;
- seven-day, revocable sessions in Postgres;
- optional authenticator-app two-factor authentication;
- account profile and security management;
- database-backed rate limiting and admin roles.

The migration copies each existing user's UUID and compatible scrypt password
hash into the Better Auth tables, so workout ownership and login credentials
survive the transition. Existing browser sessions must sign in once again.

Configure generic SMTP through `SMTP_*`. Never put `BETTER_AUTH_SECRET`, SMTP
credentials, Stripe keys, or AI keys in a `VITE_*` variable.

Seeded operator accounts remain available:

```sh
ADMIN_EMAIL="operator@example.com" \
ADMIN_PASSWORD="a-long-unique-password" \
npm run db:seed
```

The primary seeded account receives the Better Auth `admin` role when those
tables are present. Password rotation revokes both legacy and Better Auth
sessions.

## Stripe subscriptions

Stripe is optional and off by default. To enable it:

1. Create one recurring monthly price and one recurring annual price.
2. Configure EU tax registrations and Stripe Tax.
3. Configure the Stripe customer portal and cancellation behavior.
4. Register `https://<origin>/api/auth/stripe/webhook`.
5. Set `BILLING_PROVIDER=stripe`, all `STRIPE_*` values from `.env.example`,
   and the three explicit tax/portal acknowledgements to `true`.
6. Verify `/api/readiness` before accepting traffic.

Checkout and the billing portal are hosted by Stripe. COACH stores the
subscription mirror and a hashed, privacy-minimal webhook receipt ledger; card
details, invoices, and tax records stay in Stripe. Account deletion first
cancels active subscriptions and deletes the Stripe customer. If Stripe is not
reachable/configured, deletion is blocked rather than orphaning a paid account.

## Environment and readiness

See [`.env.example`](.env.example) for the complete variable list.

Important rules:

- `APP_ENV` is exactly `local`, `staging`, or `production`.
- every environment has its own database, Better Auth secret, SMTP credentials,
  Stripe mode/resources, AI key, and canonical origin;
- `PUBLIC_ORIGIN` is canonical HTTPS outside local development;
- `TRUST_PROXY_HEADERS=true` only when Coolify is the exclusive trusted proxy;
- server/browser auth and signup switches must match;
- public signup requires email delivery and published legal operator details;
- production readiness refuses the legacy local auth provider;
- Stripe readiness requires both prices, webhook verification, tax setup, and
  the customer portal.

`/api/health` verifies the process and database. `/api/readiness` additionally
verifies configuration and database environment ownership.

## Database workflow

```sh
npm run db:generate
npm run db:migrate
npm run db:studio
```

Never use `db:push` against staging or production. Committed SQL migrations run
at container startup under a Postgres advisory lock. The startup guard records
database ownership and refuses cross-environment connections.

## Quality gates

```sh
npm test
npm run lint
npm run build
npm audit --omit=dev
```

Before release, also run the local browser regression flow at 384x824 and verify
sign-up, verification, recovery, sign-in, 2FA, session revocation, account
deletion, checkout in Stripe test mode, webhook replay idempotency, and the
existing onboarding/workout/nutrition/reset/PWA smoke suite.

## Coolify

Use three isolated resources:

- local development outside Coolify;
- staging app + staging Postgres, tracking `codex/staging` and auto-deploying
  from GitHub;
- production app + production Postgres, deployed explicitly only.

The Docker image builds the Nitro server, runs migrations, verifies database
ownership, optionally refreshes seeded operator credentials, and then starts on
port `3000`. Configure Coolify's health check as `/api/health`.

Non-secret IDs and URLs live in [ops/environments.json](ops/environments.json).
The deployment workflow is documented in
[docs/deployment-runbook.md](docs/deployment-runbook.md). Secrets remain in
local `.env` files or the matching Coolify environment only.

## Privacy and launch gate

COACH includes versioned terms, privacy and explicit health-data consent,
adult attestation, account export, memory controls, and account deletion. It
also clearly states that AI coaching and nutrition estimates are not medical
advice.

Before opening registration, publish the real controller identity and contact,
list actual processors and transfer safeguards, complete DPAs, define backup
retention, test restoration and deletion from backups, configure incident
response/monitoring, and obtain qualified EU consumer/privacy review. The
repository controls are a strong technical baseline, not legal certification.
