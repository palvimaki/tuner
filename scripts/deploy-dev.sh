#!/usr/bin/env bash
# Deploy the current working tree to the dev mirror at tuner.hoitovirhe.fi.
# Faster and more permissive than scripts/deploy.sh: tests are off by default,
# and smoke checks run from Haukka itself because the dev site is IP-allowlisted.

set -euo pipefail

export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

DEPLOY_HOST="haukka"
DEPLOY_PATH="/var/www/tuner.hoitovirhe.fi/"
DEV_URL="https://tuner.hoitovirhe.fi"

STRICT=false
DRYRUN=false
for arg in "$@"; do
  case "$arg" in
    --strict)  STRICT=true ;;
    --dry-run) DRYRUN=true ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

npm ci
if $STRICT; then
  npm run test
fi
npm run build

if $DRYRUN; then
  rsync -az --delete --dry-run dist/ "${DEPLOY_HOST}:${DEPLOY_PATH}"
  exit 0
fi

rsync -az --delete dist/ "${DEPLOY_HOST}:${DEPLOY_PATH}"

# Smoke from Haukka (always in the allowlist). curl returns a one-line summary
# per probed path; a non-2xx on / fails the deploy.
ssh "$DEPLOY_HOST" bash -c "'
  set -e
  curl -fsS -o /dev/null -w \"GET /            status=%{http_code} type=%{content_type}\\n\" ${DEV_URL}/
  curl -fsS -o /dev/null -w \"GET /sw.js       status=%{http_code} type=%{content_type}\\n\" ${DEV_URL}/sw.js
  curl -fsS -o /dev/null -w \"GET /index.html  status=%{http_code} type=%{content_type}\\n\" ${DEV_URL}/index.html
'"

echo "Deployed dev build to ${DEV_URL}"
