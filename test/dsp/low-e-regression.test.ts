import { describe, expect, it } from "vitest";

import { findPitchMpm } from "../../src/audio/dsp/mpm";
import { makePluckSignal } from "./fixtures/signals";

describe("low E regression", () => {
  it("keeps low E in range with the long window", () => {
    const signal = makePluckSignal(82.4069, { length: 4096 });
    const result = findPitchMpm(signal, 44_100);
    expect(Math.abs(result.hz - 82.4069)).toBeLessThan(2.5);
  });
});
