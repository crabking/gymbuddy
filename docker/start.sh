#!/bin/sh
set -e

# 1. Fail closed before touching the database if public configuration is bad.
node verify-runtime.mjs

# 2. Apply DB migrations.
node migrate.mjs

# 3. Refuse to boot against a database owned by another environment.
node verify-environment.mjs

# 4. Seed/refresh the operator login if credentials are provided (idempotent).
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  node seed.mjs
fi

# 5. Boot the server.
exec node .output/server/index.mjs
