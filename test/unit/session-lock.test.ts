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

  it("keeps the lock timer through small pitch jitter", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E4";
    state.mode = "latched";
    const frame = {
      clarity: 0.98,
      rmsDb: -16,
      shortRmsDb: -16,
      slowRmsDb: -30,
      onset: false,
      variance: 1e-3,
      amplitude: 0.2,
      sampleWindow: 2048 as const,
      profileScores: {
        E2: -20,
        A2: -18,
        D3: -16,
        G3: -12,
        B3: -10,
        E4: -4,
      },
      timestampMs: 0,
    };

    applyAnalysisFrame(state, { ...frame, hz: 329.628 }, preset, 0);
    applyAnalysisFrame(state, { ...frame, hz: 330.963 }, preset, 800);
    const effect = applyAnalysisFrame(state, { ...frame, hz: 328.866 }, preset, 1_050);

    expect(effect.lockedStringId).toBe("E4");
    expect(state.strings.E4.lockedInThisSession).toBe(true);
  });

  it("locks high E when pitch frames are octave-shifted harmonics", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E4";
    state.mode = "latched";
    const frame = {
      clarity: 0.96,
      rmsDb: -16,
      shortRmsDb: -16,
      slowRmsDb: -30,
      onset: false,
      variance: 1e-3,
      amplitude: 0.2,
      sampleWindow: 2048 as const,
      profileScores: {
        E2: -33,
        A2: -28,
        D3: -24,
        G3: -18,
        B3: -14,
        E4: -4,
      },
      timestampMs: 0,
    };

    applyAnalysisFrame(state, { ...frame, hz: 659.256 }, preset, 0);
    const effect = applyAnalysisFrame(state, { ...frame, hz: 659.256 }, preset, 1_050);

    expect(effect.lockedStringId).toBe("E4");
    expect(state.strings.E4.lockedInThisSession).toBe(true);
    expect(state.strings.E4.lockedAtMs).toBe(1_050);
  });

  it("shows in-tune progress even with weak profile score", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E4";
    state.mode = "latched";

    const effect = applyAnalysisFrame(
      state,
      {
        hz: 329.628,
        clarity: 0.95,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -32,
        onset: false,
        variance: 1e-3,
        amplitude: 0.2,
        sampleWindow: 2048,
        profileScores: {
          E2: -94,
          A2: -93,
          D3: -92,
          G3: -91,
          B3: -90,
          E4: -92,
        },
        timestampMs: 0,
      },
      preset,
      0,
    );

    expect(effect.lockedStringId).toBeNull();
    expect(state.strings.E4.lockStartedMs).toBe(0);
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
      1_050,
    );

    expect(effect.completed).toBe(true);
    expect(state.mode).toBe("completed");
  });
});
