import { describe, expect, it } from "vitest";

import { createInitialState } from "../../src/app/state";
import { guitarPresets } from "../../src/domain/instruments/guitar/presets";
import { buildRenderState, computeStringXs, nearestStringIndexFromX } from "../../src/ui/scene";

describe("render state", () => {
  it("uses octave labels and exposes the in-tune progress state", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E4";
    state.strings.E4.lockStartedMs = 1_000;

    const renderState = buildRenderState(state, preset, false, 1_375);
    const highE = renderState.strings.find((stringState) => stringState.id === "E4");

    expect(renderState.strings.map((stringState) => stringState.label)).toEqual([
      "E2",
      "A2",
      "D3",
      "G3",
      "B3",
      "E4",
    ]);
    expect(highE?.inTune).toBe(true);
    expect(highE?.lockProgress).toBeCloseTo(0.75);
  });

  it("exposes a done pulse after a string locks", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E4";
    state.strings.E4.lockedInThisSession = true;
    state.strings.E4.lockedAtMs = 2_000;

    const renderState = buildRenderState(state, preset, false, 2_300);
    const highE = renderState.strings.find((stringState) => stringState.id === "E4");

    expect(highE?.donePulse).toBeGreaterThan(0.6);
  });

  it("hit-tests the same padded string positions used by the canvas renderer", () => {
    const width = 1000;
    const xs = computeStringXs(width, 6);

    expect(nearestStringIndexFromX(width, 6, xs[0])).toBe(0);
    expect(nearestStringIndexFromX(width, 6, xs[4])).toBe(4);
    expect(nearestStringIndexFromX(width, 6, xs[5])).toBe(5);
  });
});
