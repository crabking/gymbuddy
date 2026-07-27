# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:22-slim AS build
WORKDIR /app

# Coolify supplies the checked-out revision as a build argument. Declaring it
# makes the exact deployed commit available to Vite's version marker.
ARG SOURCE_COMMIT
ARG COOLIFY_GIT_COMMIT_SHA
ARG VITE_AUTH_PROVIDER=local
ARG VITE_PUBLIC_SIGNUPS_ENABLED=false
ENV VITE_AUTH_PROVIDER=$VITE_AUTH_PROVIDER
ENV VITE_PUBLIC_SIGNUPS_ENABLED=$VITE_PUBLIC_SIGNUPS_ENABLED

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage ----
# The app runs from Nitro's self-contained .output bundle. We also install
# production deps so migrate.mjs / seed.mjs (drizzle-orm + pg) can run at start.
FROM node:22-slim AS runtime
WORKDIR /app

ARG VITE_AUTH_PROVIDER=local
ARG VITE_PUBLIC_SIGNUPS_ENABLED=false
ENV NODE_ENV=production
ENV VITE_AUTH_PROVIDER=$VITE_AUTH_PROVIDER
ENV VITE_PUBLIC_SIGNUPS_ENABLED=$VITE_PUBLIC_SIGNUPS_ENABLED
# Nitro's node-server listens on 0.0.0.0:$PORT (default 3000).
ENV PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node --from=build /app/.output ./.output
COPY --chown=node:node --from=build /app/drizzle ./drizzle
COPY --chown=node:node --from=build /app/src/db/seed.mjs ./seed.mjs
COPY --chown=node:node docker/migrate.mjs ./migrate.mjs
COPY --chown=node:node docker/verify-runtime.mjs ./verify-runtime.mjs
COPY --chown=node:node docker/verify-environment.mjs ./verify-environment.mjs
COPY --chown=node:node docker/start.sh ./start.sh
RUN chmod +x ./start.sh

EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["./start.sh"]
