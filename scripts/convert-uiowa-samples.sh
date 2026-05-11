#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://theremin.music.uiowa.edu"
PAGE_URL="${BASE_URL}/MISguitar.html"
OUT_DIR="sources/uiowa"

mkdir -p "${OUT_DIR}"

echo "Verifying UIowa guitar source page..."
curl -fsS "${PAGE_URL}" >/dev/null

cat <<'EOF'
UIowa MIS guitar URLs are reachable, but this build does not redistribute those recordings
unless an explicit PD/CC0/CC-BY grant is documented for the selected files.

If that license posture changes later, download and convert these exact filenames:
  Guitar.mf.sulE.E2B2.mono.aif
  Guitar.mf.sulA.A2B2.mono.aif
  Guitar.mf.sulD.D3B3.mono.aif
  Guitar.mf.sulG.G3B3.mono.aif
  Guitar.mf.sulB.B3.mono.aif
  Guitar.mf.sul_E.E4B4.mono.aif
EOF
