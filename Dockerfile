# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage ----
# The app runs from Nitro's self-contained .output bundle. We also install
# production deps so migrate.mjs / seed.mjs (drizzle-orm + pg) can run at start.
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Nitro's node-server listens on 0.0.0.0:$PORT (default 3000).
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src/db/seed.mjs ./seed.mjs
COPY docker/migrate.mjs ./migrate.mjs
COPY docker/start.sh ./start.sh
RUN chmod +x ./start.sh

EXPOSE 3000
CMD ["./start.sh"]
