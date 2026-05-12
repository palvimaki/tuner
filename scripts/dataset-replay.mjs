#!/usr/bin/env node
// Local-only dataset/replay summarizer.
//
// Reads a JSON manifest pointing at locally-held recordings (which are NEVER
// committed — see .gitignore) and emits a deterministic JSON summary of the
// declared features. Recordings are not loaded by this script; only the
// manifest's declared metadata + fixture features are summarized. This keeps
// the tool dependency-free and safe to run in CI without user audio.
//
// Usage:
//   node scripts/dataset-replay.mjs <manifest.json> [--out path]
//
// Manifest shape:
// {
//   "datasetId": "string",
//   "version": "string",
//   "entries": [
//     {
//       "id": "string",
//       "instrument": "guitar",
//       "stringId": "E2",
//       "targetHz": 82.41,
//       "durationMs": 1234,
//       // Optional pre-computed features (the only data we summarize).
//       "features": { "rmsDb": -22.1, "clarity": 0.93 }
//     }
//   ]
// }

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function die(msg, code = 1) {
  process.stderr.write(`dataset-replay: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { manifest: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      args.out = argv[++i];
    } else if (!args.manifest) {
      args.manifest = a;
    }
  }
  return args;
}

function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = sortedKeys(value);
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") +
    "}"
  );
}

function summarizeEntry(entry) {
  const features = entry.features ?? {};
  const featureKeys = sortedKeys(features);
  let featureSum = 0;
  let featureCount = 0;
  for (const k of featureKeys) {
    const v = features[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      featureSum += v;
      featureCount += 1;
    }
  }
  return {
    id: entry.id,
    instrument: entry.instrument ?? null,
    stringId: entry.stringId ?? null,
    targetHz: typeof entry.targetHz === "number" ? entry.targetHz : null,
    durationMs: typeof entry.durationMs === "number" ? entry.durationMs : null,
    featureKeys,
    featureMean: featureCount > 0 ? featureSum / featureCount : null,
  };
}

function summarize(manifest) {
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const summarized = entries
    .map(summarizeEntry)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byInstrument = {};
  for (const e of summarized) {
    const key = e.instrument ?? "_unknown";
    byInstrument[key] = (byInstrument[key] ?? 0) + 1;
  }
  return {
    datasetId: manifest.datasetId ?? null,
    version: manifest.version ?? null,
    entryCount: summarized.length,
    byInstrument,
    entries: summarized,
  };
}

export function summarizeManifest(manifest) {
  return summarize(manifest);
}

export function summarizeManifestJson(json) {
  return stableStringify(summarize(json));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest) {
    die("usage: dataset-replay.mjs <manifest.json> [--out path]");
  }
  const path = resolve(args.manifest);
  if (!existsSync(path)) {
    die(`manifest not found: ${path}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    die(`failed to parse manifest: ${err.message}`);
  }
  const out = stableStringify(summarize(manifest));
  if (args.out) {
    writeFileSync(resolve(args.out), out + "\n");
  } else {
    process.stdout.write(out + "\n");
  }
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("dataset-replay.mjs");
if (invokedDirectly) {
  main();
}
