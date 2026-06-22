#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

assert_content_type() {
  local url="$1"
  local expected="$2"
  local headers content_type

  headers="$(curl -fsSI "$url" | tr -d '\r')"
  content_type="$(printf '%s\n' "$headers" | awk -F': ' 'tolower($1)=="content-type"{print tolower($2); exit}')"

  if [[ -z "$content_type" || "$content_type" != *"$expected"* ]]; then
    echo "Unexpected Content-Type for $url: ${content_type:-<missing>}" >&2
    return 1
  fi
}

assert_status() {
  local url="$1"
  local expected="$2"
  local status

  status="$(curl -sSI -o /dev/null -w '%{http_code}' "$url")"
  if [[ "$status" != "$expected" ]]; then
    echo "Unexpected status for $url: $status (expected $expected)" >&2
    return 1
  fi
}

DEPLOY_HOST="${DEPLOY_HOST:-haukka}"
: "${DEPLOY_PATH:=/var/www/tuner.fi/}"
DEPLOY_URL="${DEPLOY_URL:-}"
if [[ -z "$DEPLOY_URL" ]]; then
  if [[ "$DEPLOY_HOST" == "haukka" ]]; then
    DEPLOY_URL="https://tuner.fi"
  else
    echo "Set DEPLOY_URL to the public URL being deployed, e.g. https://tuner.fi" >&2
    exit 2
  fi
fi
DEPLOY_URL="${DEPLOY_URL%/}"
RSYNC_EXCLUDES=(--exclude '.DS_Store' --exclude '.well-known/')

npm ci
npm run test
npm run build

if [[ "${1:-}" == "--dry-run" ]]; then
  rsync -az --delete "${RSYNC_EXCLUDES[@]}" --dry-run dist/ "${DEPLOY_HOST}:${DEPLOY_PATH}"
  exit 0
fi

# --delay-updates: hold every updated file in a temp name until the whole
# transfer completes, then rename them into place together. Prevents the
# half-mixed state where index.html (referencing main-NEW.js) lands before the
# new JS asset — an interrupted rsync leaves the previous tree intact.
rsync -az --delete --delay-updates "${RSYNC_EXCLUDES[@]}" dist/ "${DEPLOY_HOST}:${DEPLOY_PATH}"
curl -fsS "${DEPLOY_URL}/" >/dev/null

hashed_js_path="$(
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const manifest = JSON.parse(readFileSync("dist/.vite/manifest.json", "utf8"));
    const file = Object.values(manifest)
      .map((entry) => entry?.file)
      .find((value) => typeof value === "string" && value.endsWith(".js"));
    if (!file) process.exit(1);
    process.stdout.write(`/${file}`);
  '
)"

assert_content_type "${DEPLOY_URL}/sw.js" "javascript"
assert_content_type "${DEPLOY_URL}${hashed_js_path}" "javascript"
assert_status "${DEPLOY_URL}/audio/guitar/E2.m4a" "404"
assert_status "${DEPLOY_URL}/assets/does-not-exist.js" "404"
assert_status "${DEPLOY_URL}/.env" "404"
assert_status "${DEPLOY_URL}/.DS_Store" "404"
