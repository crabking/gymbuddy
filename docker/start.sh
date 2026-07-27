#!/bin/sh
set -e

# 1. Apply DB migrations.
node migrate.mjs

# 2. Refuse to boot against a database owned by another environment.
node verify-environment.mjs

# 3. Seed/refresh the invite login if credentials are provided (idempotent).
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  node seed.mjs
fi

# 4. Boot the server.
exec node .output/server/index.mjs
