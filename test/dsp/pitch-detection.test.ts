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

  it("keeps high E within 15 cents on a harmonic stack", () => {
    const targetHz = 329.628;
    const signal = makePluckSignal(targetHz, {
      length: 2_048,
      harmonics: [0.42, 1, 0.78, 0.55, 0.34],
    });
    const result = findPitchMpm(signal, 44_100);
    const cents = 1200 * Math.log2(result.hz / targetHz);
    expect(Math.abs(cents)).toBeLessThanOrEqual(15);
  });
});
