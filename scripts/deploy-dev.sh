#!/usr/bin/env bash
# Deploy the current working tree to the dev mirror. Smoke checks run from the
# deploy host by default because the dev mirror may be IP-allowlisted.

set -euo pipefail

export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

DEPLOY_HOST="${DEPLOY_HOST:-haukka}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/tuner.hoitovirhe.fi/}"
DEPLOY_URL="${DEPLOY_URL:-https://tuner.hoitovirhe.fi}"
VERIFY_HOST="${VERIFY_HOST:-$DEPLOY_HOST}"
DEPLOY_URL="${DEPLOY_URL%/}"
RSYNC_EXCLUDES=(--exclude '.DS_Store' --exclude '.well-known/')

STRICT=false
DRYRUN=false
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=true ;;
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
  rsync -az --delete "${RSYNC_EXCLUDES[@]}" --dry-run dist/ "${DEPLOY_HOST}:${DEPLOY_PATH}"
  exit 0
fi

rsync -az --delete --delay-updates "${RSYNC_EXCLUDES[@]}" dist/ "${DEPLOY_HOST}:${DEPLOY_PATH}"

ssh "$VERIFY_HOST" "DEPLOY_URL='$DEPLOY_URL' bash -s" <<'EOF'
set -euo pipefail
curl -fsS -o /dev/null -w "GET /            status=%{http_code} type=%{content_type}\n" "${DEPLOY_URL}/"
curl -fsS -o /dev/null -w "GET /sw.js       status=%{http_code} type=%{content_type}\n" "${DEPLOY_URL}/sw.js"
curl -fsS -o /dev/null -w "GET /index.html  status=%{http_code} type=%{content_type}\n" "${DEPLOY_URL}/index.html"
EOF

echo "Deployed dev build to ${DEPLOY_URL}"
