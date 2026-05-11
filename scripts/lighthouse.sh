#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-4173}"

npm run build
npx vite preview --host 127.0.0.1 --port "${PORT}" >/tmp/tuner-vite-preview.log 2>&1 &
PID=$!
trap 'kill "${PID}" >/dev/null 2>&1 || true' EXIT

sleep 3

npx lighthouse "http://127.0.0.1:${PORT}/app/" \
  --quiet \
  --chrome-flags="--headless=new" \
  --only-categories=performance,pwa,accessibility,best-practices
