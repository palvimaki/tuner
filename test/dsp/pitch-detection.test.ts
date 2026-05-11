import { describe, expect, it } from "vitest";

import { findPitchMpm } from "../../src/audio/dsp/mpm";
import { makePluckSignal } from "./fixtures/signals";

describe("MPM pitch detection", () => {
  it("resolves E2 cleanly in a 4096-sample window", () => {
    const signal = makePluckSignal(82.4069);
    const result = findPitchMpm(signal, 44_100);
    expect(result.hz).toBeGreaterThan(81);
    expect(result.hz).toBeLessThan(84);
    expect(result.clarity).toBeGreaterThan(0.8);
  });
});
