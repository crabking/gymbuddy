# COACH

A mobile-first AI personal trainer. An agentic coach that writes workout plans,
builds training schedules, tracks meals and macros, and remembers your progress.

**Stack:** TanStack Start (React 19, SSR) · Vite · Tailwind v4 · shadcn/ui ·
**Postgres + Drizzle ORM** · provider-selectable local or Clerk authentication ·
Vercel AI SDK (OpenAI-compatible **or** Anthropic) · Nitro (`node-server`) for
self-hosting.

Fully self-contained — no Supabase or Lovable. Local development defaults to
invite-only cookie authentication. Clerk can provide email verification,
password reset, social login, MFA, account management, and optional public
registration without changing the UUIDs that own training data.

## Local development

Requires Node 20.19+ / 22.12+ and Docker (for local Postgres).

```sh
npm install
cp .env.example .env          # fill in the values
docker compose up -d          # local Postgres on localhost:5433
npm run db:migrate            # create tables
npm run db:seed               # create your login (uses ADMIN_EMAIL / ADMIN_PASSWORD)
npm run dev                   # http://localhost:8080
```

### Install on a phone

The production site is an installable web app. It must be served over HTTPS.

- **Android:** open the site in Chrome, then choose **Install app**.
- **iPhone:** open the site in Safari, tap **Share**, then **Add to Home Screen**.

### Environment variables

See [`.env.example`](.env.example).

| Variable                         | Purpose                                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`                   | Postgres connection string                                              |
| `DB_POOL_MAX`                    | Maximum database connections used by an app replica (default `10`)      |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | The login created/refreshed by `db:seed` (and on container start)       |
| `AI_PROVIDER`                    | `openai` (default, any OpenAI-compatible endpoint) or `anthropic`       |
| `AI_API_KEY`                     | Key for the chosen provider                                             |
| `PUBLIC_ORIGIN`                  | Canonical production HTTPS origin used for origin checks                |
| `TRUST_PROXY_HEADERS`            | Enable only behind a trusted proxy that overwrites forwarded IP headers |
| `AI_MODEL`                       | Model id (e.g. `gpt-5.5`, or `claude-sonnet-5`)                         |
| `AI_BASE_URL`                    | OpenAI mode only — override the base URL (OpenAI, OpenRouter, Groq, …)  |
| `AUTH_PROVIDER`                  | `local` (default) or `clerk` on the server                              |
| `VITE_AUTH_PROVIDER`             | Must match `AUTH_PROVIDER`; embedded in the browser build               |
| `VITE_CLERK_PUBLISHABLE_KEY`     | Clerk public key; required at build time when Clerk is enabled          |
| `CLERK_SECRET_KEY`               | Clerk Backend API secret; runtime only                                  |
| `CLERK_WEBHOOK_SIGNING_SECRET`   | Verifies `/api/clerk/webhooks`; runtime only                            |
| `BILLING_PROVIDER`               | `disabled` (default) or `clerk`                                         |

### Database workflow (Drizzle)

- Edit the schema in [`src/db/schema.ts`](src/db/schema.ts).
- `npm run db:generate` — generate a new SQL migration from schema changes.
- `npm run db:migrate` — apply pending migrations.
- `npm run db:studio` — browse data in Drizzle Studio.

### Managing logins

With `AUTH_PROVIDER=local`, there is no sign-up UI. To add or update a person,
run the seed with their credentials (an existing email resets its password):

```sh
ADMIN_EMAIL="friend@example.com" ADMIN_PASSWORD="their-password" npm run db:seed
```

### Clerk setup

1. Create separate Clerk development and production instances.
2. Set `AUTH_PROVIDER=clerk` and `VITE_AUTH_PROVIDER=clerk`.
3. Set the publishable and secret keys for the matching instance.
4. Register `https://<origin>/api/clerk/webhooks` and subscribe to
   `user.created`, `user.updated`, `user.deleted`, plus billing events only if
   billing is enabled.
5. Set the webhook signing secret and verify `/api/readiness`.
6. Keep public sign-up off until the legal/operator launch gate is complete.

The first authenticated request provisions a local UUID immediately; webhooks
then keep identity changes synchronized. A verified Clerk email claims a
matching invited account so programs and history survive the migration.
Existing local `scrypt` hashes use a format Clerk cannot import. Existing users
must use Clerk's password-reset flow (or be migrated as they enter a plaintext
password during a controlled migration). Never copy hashes into Clerk as if
they were a supported digest.

Clerk Billing is intentionally off by default. It is not free (Clerk charges a
percentage in addition to Stripe), is currently USD-only, and Clerk documents
no tax/VAT handling or 3-D Secure. Those limitations are material for Sweden
and the EU. Enabling it requires `BILLING_PROVIDER=clerk` and
`CLERK_BILLING_LIMITATIONS_ACKNOWLEDGED=true`; obtain legal/tax review first.

## Production build

```sh
npm run build     # → .output/ (Nitro node-server bundle)
npm run start     # node .output/server/index.mjs (listens on $PORT, default 3000)
```

## Deploying on Coolify (Hetzner)

The [`Dockerfile`](Dockerfile) builds the app and, on every container start,
**runs DB migrations and re-seeds the invite login**, then boots the server. So
a normal deploy keeps the schema and your login up to date automatically.

### One-time setup

1. **Add a Postgres database** in Coolify (New Resource → Database → PostgreSQL).
   Coolify gives it an internal connection URL — copy it.
2. **Add the app** (New Resource → Application → your GitHub repo
   `crabking/gymbuddy`). Build Pack: **Dockerfile**.
3. **Environment variables** on the app:
   - `DATABASE_URL` = the Postgres internal URL from step 1
     (e.g. `postgres://postgres:PASS@<db-service>:5432/postgres`)
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` = your login
   - `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` (and `AI_BASE_URL` if OpenAI mode)
   - `PUBLIC_ORIGIN` = the app's one canonical HTTPS URL
   - `TRUST_PROXY_HEADERS=true` when Coolify is the only route to the container
   - `APP_ENV=production`
   - `LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL`, and
     `LEGAL_OPERATOR_COUNTRY` = the real public operator/controller details
   - `PUBLIC_SIGNUPS_ENABLED=false` while the service remains invite-only
   - `VITE_PUBLIC_SIGNUPS_ENABLED=false` at build time
   - Local auth: `AUTH_PROVIDER=local`, `VITE_AUTH_PROVIDER=local`
   - Clerk auth: the Clerk variables listed above; secret and webhook values
     remain runtime-only
   - `NODE_ENV=production`
4. **Port / domain:** the container listens on **3000**. Set the port to `3000`,
   attach your domain under _Domains_, and Coolify terminates TLS for you — that's
   what makes it reachable from the outside.
5. **Deploy.**

Set the Coolify application health check path to `/api/health`. This checks both
the web process and its Postgres connection; the container uses the same check.
`/api/readiness` additionally checks production configuration and the database's
environment marker.

### Staging

Staging is a separate Coolify application and PostgreSQL database. It runs
`APP_ENV=staging`, uses the `codex/staging` branch, and never contains production
user data. The startup environment guard permanently marks a database on first
boot and refuses to start if a staging app is accidentally given a production
database URL (or vice versa).

Non-secret resource IDs, branches, and URLs live in
[`ops/environments.json`](ops/environments.json). Runtime keys remain in
Coolify. The local `coach-operations` Codex skill documents the full build,
deploy, verification, and rollback workflow without storing credentials.

### Privacy and launch gate

COACH provides versioned terms/privacy/health consent, account export, and
in-app account deletion. Public registration must stay disabled until the legal
operator name and monitored contact address are configured, actual subprocessors
and international transfers are documented, backup retention is published and
a restore has been tested. These technical controls are not a substitute for
qualified legal review.

### Backups

Enable scheduled PostgreSQL backups in Coolify and retain multiple daily
snapshots. For recovery if the server itself is lost, also connect an
S3-compatible off-server destination. Test a restore periodically.

### Auto-deploy on git push

In the app's **Webhooks** tab, Coolify shows a GitHub webhook URL and secret.
Add them to the repo (GitHub → Settings → Webhooks), or connect the GitHub App
from Coolify's _Sources_. After that, every push to `main` triggers a clean
rebuild + redeploy. (You can also hit the **Deploy Webhook** URL from CI.)

### Adding more people later

Change `ADMIN_EMAIL` / `ADMIN_PASSWORD` and redeploy, or open the app's Coolify
**Terminal** and run:

```sh
ADMIN_EMAIL="friend@example.com" ADMIN_PASSWORD="a-long-password" node seed.mjs
```

## Notes

- Local auth uses email/password with HTTP-only cookie sessions and Node
  `scrypt`. Clerk mode adds managed verification, recovery, MFA, user profile,
  and session handling while the app database remains authoritative for fitness
  data.
- Access control is enforced in the query layer — every query filters by the
  session user id.
