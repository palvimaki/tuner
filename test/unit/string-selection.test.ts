import { describe, expect, it } from "vitest";

import { applyAnalysisFrame, createInitialState } from "../../src/app/state";
import { guitarPresets } from "../../src/domain/instruments/guitar/presets";

describe("string switching hysteresis", () => {
  it("requires four strong frames before switching strings", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E2";
    state.mode = "latched";

    for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) {
      applyAnalysisFrame(
        state,
        {
          hz: 110,
          clarity: 0.96,
          rmsDb: -18,
          shortRmsDb: -18,
          slowRmsDb: -32,
          onset: false,
          variance: 1e-3,
          amplitude: 0.34,
          sampleWindow: 2048,
          profileScores: {
            E2: -28,
            A2: -9,
            D3: -25,
            G3: -30,
            B3: -34,
            E4: -38,
          },
          timestampMs: 0,
        },
        preset,
        200 + frameIndex * 30,
      );
      expect(state.activeStringId).toBe("E2");
    }

    applyAnalysisFrame(
      state,
      {
        hz: 110,
        clarity: 0.96,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -32,
        onset: false,
        variance: 1e-3,
        amplitude: 0.34,
        sampleWindow: 2048,
        profileScores: {
          E2: -28,
          A2: -9,
          D3: -25,
          G3: -30,
          B3: -34,
          E4: -38,
        },
        timestampMs: 0,
      },
      preset,
      320,
    );

    expect(state.activeStringId).toBe("A2");
  });
});
