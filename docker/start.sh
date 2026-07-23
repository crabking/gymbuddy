#!/bin/sh
set -e

# 1. Apply DB migrations.
node migrate.mjs

# 2. Seed/refresh the invite login if credentials are provided (idempotent).
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  node seed.mjs || echo "[start] seed failed (non-fatal), continuing"
fi

# 3. Boot the server.
exec node .output/server/index.mjs
