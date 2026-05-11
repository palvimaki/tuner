import { describe, expect, it } from "vitest";

import { createInitialState, applyAnalysisFrame } from "../../src/app/state";
import { guitarPresets } from "../../src/domain/instruments/guitar/presets";

describe("slack-string onset latch", () => {
  it("latches a slack low E around 73 Hz to E2 in standard tuning", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    applyAnalysisFrame(
      state,
      {
        hz: 73,
        clarity: 0.94,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -36,
        onset: true,
        variance: 1e-3,
        amplitude: 0.28,
        sampleWindow: 4096,
        profileScores: {
          E2: -8,
          A2: -19,
          D3: -24,
          G3: -27,
          B3: -31,
          E4: -34,
        },
        timestampMs: 0,
      },
      preset,
      0,
    );
    expect(state.activeStringId).toBe("E2");
    expect(state.mode).toBe("latched");
  });
});
