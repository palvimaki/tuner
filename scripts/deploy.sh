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

npm ci
npm run test
npm run build

if [[ "${1:-}" == "--dry-run" ]]; then
  rsync -az --delete --exclude '.DS_Store' --dry-run dist/ haukka:/var/www/tuner.fi/
  exit 0
fi

rsync -az --delete --exclude '.DS_Store' dist/ haukka:/var/www/tuner.fi/
curl -fsS https://tuner.fi/ >/dev/null

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

assert_content_type "https://tuner.fi/sw.js" "javascript"
assert_content_type "https://tuner.fi${hashed_js_path}" "javascript"
assert_status "https://tuner.fi/audio/guitar/E2.m4a" "404"
assert_status "https://tuner.fi/assets/does-not-exist.js" "404"
assert_status "https://tuner.fi/.env" "404"
assert_status "https://tuner.fi/.DS_Store" "404"
