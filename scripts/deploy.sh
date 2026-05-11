#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

npm ci
npm run test
npm run build

if [[ "${1:-}" == "--dry-run" ]]; then
  rsync -az --delete --dry-run dist/ haukka:/var/www/tuner.fi/
  exit 0
fi

rsync -az --delete dist/ haukka:/var/www/tuner.fi/
curl -fsS https://tuner.fi/ >/dev/null
