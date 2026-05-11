import { describe, expect, it } from "vitest";

import { pickPeak } from "../../src/audio/dsp/mpm";

describe("MPM peak picking", () => {
  it("chooses the first key maximum above threshold instead of the global maximum", () => {
    const nsdf = new Float32Array([
      -0.08,
      -0.02,
      0.1,
      0.92,
      0.35,
      -0.04,
      0.08,
      0.99,
      0.42,
      -0.03,
    ]);

    expect(pickPeak(nsdf)).toBe(3);
  });
});
