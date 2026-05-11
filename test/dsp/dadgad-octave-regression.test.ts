import { describe, expect, it } from "vitest";

import { applyAnalysisFrame, createInitialState } from "../../src/app/state";
import { guitarPresets } from "../../src/domain/instruments/guitar/presets";

describe("same-note octave safeguards", () => {
  it("latches D2 on onset in DADGAD", () => {
    const preset = guitarPresets.find((entry) => entry.id === "dadgad")!;
    const state = createInitialState(preset);
    applyAnalysisFrame(
      state,
      {
        hz: 73.416,
        clarity: 0.95,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -34,
        onset: true,
        variance: 1e-3,
        amplitude: 0.25,
        sampleWindow: 4096,
        profileScores: {
          D2: -8,
          A2: -18,
          D3: -14,
          G3: -22,
          A3: -27,
          D4: -31,
        },
        timestampMs: 0,
      },
      preset,
      0,
    );

    expect(state.activeStringId).toBe("D2");
  });

  it("switches from D2 to D3 only after four same-note margin frames in Open G", () => {
    const preset = guitarPresets.find((entry) => entry.id === "open-g")!;
    const state = createInitialState(preset);
    state.activeStringId = "D2";
    state.mode = "latched";

    for (let i = 0; i < 3; i += 1) {
      applyAnalysisFrame(
        state,
        {
          hz: 146.832,
          clarity: 0.95,
          rmsDb: -18,
          shortRmsDb: -18,
          slowRmsDb: -34,
          onset: false,
          variance: 1e-3,
          amplitude: 0.25,
          sampleWindow: 4096,
          profileScores: {
            D2: -18,
            G2: -24,
            D3: -8,
            G3: -28,
            B3: -32,
            D4: -20,
          },
          timestampMs: 0,
        },
        preset,
        200 + i * 40,
      );
      expect(state.activeStringId).toBe("D2");
    }

    applyAnalysisFrame(
      state,
      {
        hz: 146.832,
        clarity: 0.95,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -34,
        onset: false,
        variance: 1e-3,
        amplitude: 0.25,
        sampleWindow: 4096,
        profileScores: {
          D2: -18,
          G2: -24,
          D3: -8,
          G3: -28,
          B3: -32,
          D4: -20,
        },
        timestampMs: 0,
      },
      preset,
      360,
    );

    expect(state.activeStringId).toBe("D3");
  });

  it("switches from D3 to D4 only after four same-note margin frames in Open D", () => {
    const preset = guitarPresets.find((entry) => entry.id === "open-d")!;
    const state = createInitialState(preset);
    state.activeStringId = "D3";
    state.mode = "latched";

    for (let i = 0; i < 3; i += 1) {
      applyAnalysisFrame(
        state,
        {
          hz: 293.665,
          clarity: 0.95,
          rmsDb: -18,
          shortRmsDb: -18,
          slowRmsDb: -34,
          onset: false,
          variance: 1e-3,
          amplitude: 0.25,
          sampleWindow: 2048,
          profileScores: {
            D2: -30,
            A2: -32,
            D3: -18,
            "F#3": -22,
            A3: -28,
            D4: -8,
          },
          timestampMs: 0,
        },
        preset,
        200 + i * 40,
      );
      expect(state.activeStringId).toBe("D3");
    }

    applyAnalysisFrame(
      state,
      {
        hz: 293.665,
        clarity: 0.95,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -34,
        onset: false,
        variance: 1e-3,
        amplitude: 0.25,
        sampleWindow: 2048,
        profileScores: {
          D2: -30,
          A2: -32,
          D3: -18,
          "F#3": -22,
          A3: -28,
          D4: -8,
        },
        timestampMs: 0,
      },
      preset,
      360,
    );

    expect(state.activeStringId).toBe("D4");
  });
});
