import { describe, expect, it } from "vitest";

import {
  TRANSIENT_SUPPRESS_MS,
  isLowConfidence,
  isStableTail,
  isTransientSuppressed,
} from "../../src/audio/dsp/frame-flags";

describe("frame flags", () => {
  it("suppresses frames within the transient window after onset", () => {
    expect(isTransientSuppressed(50, 0)).toBe(true);
    expect(isTransientSuppressed(TRANSIENT_SUPPRESS_MS - 1, 0)).toBe(true);
    expect(isTransientSuppressed(TRANSIENT_SUPPRESS_MS, 0)).toBe(false);
    expect(isTransientSuppressed(400, 0)).toBe(false);
  });

  it("marks low-confidence frames when transient or below threshold", () => {
    expect(isLowConfidence(0.9, true)).toBe(true);
    expect(isLowConfidence(0.3, false)).toBe(true);
    expect(isLowConfidence(0.85, false)).toBe(false);
  });

  it("flags a stable tail only when last N frames agree within 25 cents", () => {
    expect(isStableTail([110, 110.2, 109.9])).toBe(true);
    expect(isStableTail([110, 130, 110])).toBe(false);
    expect(isStableTail([0, 110, 110])).toBe(false);
    expect(isStableTail([110])).toBe(false);
  });
});
