import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// @ts-expect-error — JS module without types; we only use its exports here.
import { summarizeManifest, summarizeManifestJson } from "../../scripts/dataset-replay.mjs";

describe("dataset-replay summary", () => {
  it("produces a deterministic summary of the fixture manifest", () => {
    const fixturePath = resolve(__dirname, "../../scripts/fixtures/dataset-sample.json");
    const manifest = JSON.parse(readFileSync(fixturePath, "utf8"));

    const summary = summarizeManifest(manifest);
    expect(summary.datasetId).toBe("tuner-fi-sample");
    expect(summary.entryCount).toBe(2);
    expect(summary.byInstrument).toEqual({ guitar: 2 });
    expect(summary.entries.map((e: { id: string }) => e.id)).toEqual([
      "guitar-A2-0001",
      "guitar-E2-0001",
    ]);

    const a = summarizeManifestJson(manifest);
    const b = summarizeManifestJson(manifest);
    expect(a).toBe(b);
  });
});
