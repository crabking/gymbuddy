# Gym Buddy

A mobile-first AI personal trainer. An agentic coach that writes workout plans,
builds training schedules, tracks meals and macros, and remembers your progress.

**Stack:** TanStack Start (React 19, SSR) · Vite · Tailwind v4 · shadcn/ui ·
**Postgres + Drizzle ORM** · self-hosted cookie-session auth · Vercel AI SDK
(OpenAI-compatible **or** Anthropic) · Nitro (`node-server`) for self-hosting.

Fully self-contained — no Supabase, no Lovable, no third-party auth. Invite-only:
the only way in is an account you seed yourself; there is no public sign-up.

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

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | The login created/refreshed by `db:seed` (and on container start) |
| `AI_PROVIDER` | `openai` (default, any OpenAI-compatible endpoint) or `anthropic` |
| `AI_API_KEY` | Key for the chosen provider |
| `AI_MODEL` | Model id (e.g. `gpt-5.5`, or `claude-sonnet-5`) |
| `AI_BASE_URL` | OpenAI mode only — override the base URL (OpenAI, OpenRouter, Groq, …) |

### Database workflow (Drizzle)

- Edit the schema in [`src/db/schema.ts`](src/db/schema.ts).
- `npm run db:generate` — generate a new SQL migration from schema changes.
- `npm run db:migrate` — apply pending migrations.
- `npm run db:studio` — browse data in Drizzle Studio.

### Managing logins

There is no sign-up UI. To add or update a person, run the seed with their
credentials (an existing email just gets its password reset):

```sh
ADMIN_EMAIL="friend@example.com" ADMIN_PASSWORD="their-password" npm run db:seed
```

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
   - `NODE_ENV=production`
4. **Port / domain:** the container listens on **3000**. Set the port to `3000`,
   attach your domain under *Domains*, and Coolify terminates TLS for you — that's
   what makes it reachable from the outside.
5. **Deploy.**

### Auto-deploy on git push

In the app's **Webhooks** tab, Coolify shows a GitHub webhook URL and secret.
Add them to the repo (GitHub → Settings → Webhooks), or connect the GitHub App
from Coolify's *Sources*. After that, every push to `main` triggers a clean
rebuild + redeploy. (You can also hit the **Deploy Webhook** URL from CI.)

### Adding more people later

Change `ADMIN_EMAIL` / `ADMIN_PASSWORD` and redeploy, or open the app's Coolify
**Terminal** and run:

```sh
ADMIN_EMAIL="friend@example.com" ADMIN_PASSWORD="pw" node seed.mjs
```

## Notes

- Auth is a self-hosted email+password with httpOnly cookie sessions; passwords
  are hashed with Node's `scrypt` (no native deps). No email/confirmation flow.
- Access control is enforced in the query layer — every query filters by the
  session user id.
