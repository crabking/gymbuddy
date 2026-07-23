# Agent notes

This is a self-hosted TanStack Start app (no Lovable coupling). Deploys as a
Node server via Nitro's `node-server` preset, containerized for Coolify/Hetzner
(see `Dockerfile` and the Deployment section of `README.md`).

- Runtime env vars: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `AI_API_KEY`,
  and optionally `AI_BASE_URL` / `AI_MODEL`. Client build also needs the
  `VITE_SUPABASE_*` equivalents. See `.env.example`.
- The LLM backend is any OpenAI-compatible endpoint, configured in
  `src/lib/ai-provider.server.ts`.
