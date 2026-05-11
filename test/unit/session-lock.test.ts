import { describe, expect, it } from "vitest";

import { applyAnalysisFrame, createInitialState } from "../../src/app/state";
import { guitarPresets } from "../../src/domain/instruments/guitar/presets";

describe("session lock and completion", () => {
  it("locks a string after 1.5 seconds in tune", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E2";
    state.mode = "latched";

    let effect = applyAnalysisFrame(
      state,
      {
        hz: 82.4069,
        clarity: 0.98,
        rmsDb: -16,
        shortRmsDb: -16,
        slowRmsDb: -30,
        onset: false,
        variance: 1e-3,
        amplitude: 0.2,
        sampleWindow: 4096,
        profileScores: {
          E2: -6,
          A2: -20,
          D3: -26,
          G3: -30,
          B3: -34,
          E4: -39,
        },
        timestampMs: 0,
      },
      preset,
      0,
    );
    expect(effect.lockedStringId).toBeNull();

    effect = applyAnalysisFrame(
      state,
      {
        hz: 82.4069,
        clarity: 0.98,
        rmsDb: -16,
        shortRmsDb: -16,
        slowRmsDb: -30,
        onset: false,
        variance: 1e-3,
        amplitude: 0.2,
        sampleWindow: 4096,
        profileScores: {
          E2: -6,
          A2: -20,
          D3: -26,
          G3: -30,
          B3: -34,
          E4: -39,
        },
        timestampMs: 0,
      },
      preset,
      1_600,
    );

    expect(effect.lockedStringId).toBe("E2");
    expect(state.strings.E2.lockedInThisSession).toBe(true);
  });

  it("fires completion once the last string locks", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    for (const stringDef of preset.strings.slice(0, -1)) {
      state.strings[stringDef.id].lockedInThisSession = true;
    }
    state.activeStringId = "E4";
    state.mode = "latched";

    applyAnalysisFrame(
      state,
      {
        hz: 329.628,
        clarity: 0.97,
        rmsDb: -16,
        shortRmsDb: -16,
        slowRmsDb: -30,
        onset: false,
        variance: 1e-3,
        amplitude: 0.2,
        sampleWindow: 2048,
        profileScores: {
          E2: -40,
          A2: -37,
          D3: -30,
          G3: -22,
          B3: -12,
          E4: -4,
        },
        timestampMs: 0,
      },
      preset,
      0,
    );
    const effect = applyAnalysisFrame(
      state,
      {
        hz: 329.628,
        clarity: 0.97,
        rmsDb: -16,
        shortRmsDb: -16,
        slowRmsDb: -30,
        onset: false,
        variance: 1e-3,
        amplitude: 0.2,
        sampleWindow: 2048,
        profileScores: {
          E2: -40,
          A2: -37,
          D3: -30,
          G3: -22,
          B3: -12,
          E4: -4,
        },
        timestampMs: 0,
      },
      preset,
      1_600,
    );

    expect(effect.completed).toBe(true);
    expect(state.mode).toBe("completed");
  });
});
