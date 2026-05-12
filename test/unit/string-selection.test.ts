import { describe, expect, it } from "vitest";

import { applyAnalysisFrame, createInitialState, setManualTarget } from "../../src/app/state";
import { scorePresetProfiles } from "../../src/audio/dsp/harmonic-profile";
import { guitarPresets } from "../../src/domain/instruments/guitar/presets";
import { makePluckSignal } from "../dsp/fixtures/signals";

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

  it("acquires high E from stable frames when onset is missed", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    const profileScores = scorePresetProfiles(
      makePluckSignal(329.628, {
        length: 2_048,
        harmonics: [0.42, 1, 0.78, 0.55, 0.34],
      }),
      44_100,
      preset,
    );

    for (let frameIndex = 0; frameIndex < 2; frameIndex += 1) {
      applyAnalysisFrame(
        state,
        {
          hz: 329.628,
          clarity: 0.96,
          rmsDb: -18,
          shortRmsDb: -18,
          slowRmsDb: -32,
          onset: false,
          variance: 1e-3,
          amplitude: 0.26,
          sampleWindow: 2048,
          profileScores,
          timestampMs: 0,
        },
        preset,
        200 + frameIndex * 30,
      );
    }

    expect(state.activeStringId).toBe("E4");
    expect(state.mode).toBe("latched");
  });

  it("acquires high E when the pitch detector reports an upper harmonic", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);

    for (let frameIndex = 0; frameIndex < 2; frameIndex += 1) {
      applyAnalysisFrame(
        state,
        {
          hz: 988.884,
          clarity: 0.93,
          rmsDb: -18,
          shortRmsDb: -18,
          slowRmsDb: -32,
          onset: false,
          variance: 1e-3,
          amplitude: 0.26,
          sampleWindow: 2048,
          profileScores: {
            E2: -33,
            A2: -28,
            D3: -24,
            G3: -18,
            B3: -14,
            E4: -4,
          },
          timestampMs: 0,
        },
        preset,
        200 + frameIndex * 30,
      );
    }

    expect(state.activeStringId).toBe("E4");
    expect(Math.abs(state.strings.E4.cents ?? Infinity)).toBeLessThanOrEqual(1);
  });

  it("acquires high E by pitch even when profile scores are weak", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);

    for (let frameIndex = 0; frameIndex < 2; frameIndex += 1) {
      applyAnalysisFrame(
        state,
        {
          hz: 329.628,
          clarity: 0.93,
          rmsDb: -18,
          shortRmsDb: -18,
          slowRmsDb: -32,
          onset: false,
          variance: 1e-3,
          amplitude: 0.22,
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
        200 + frameIndex * 30,
      );
    }

    expect(state.activeStringId).toBe("E4");
  });

  it("switches from B to high E after four strong high-E frames", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "B3";
    state.mode = "latched";
    const profileScores = scorePresetProfiles(
      makePluckSignal(329.628, {
        length: 2_048,
        harmonics: [0.42, 1, 0.78, 0.55, 0.34],
      }),
      44_100,
      preset,
    );

    for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) {
      applyAnalysisFrame(
        state,
        {
          hz: 329.628,
          clarity: 0.96,
          rmsDb: -18,
          shortRmsDb: -18,
          slowRmsDb: -32,
          onset: false,
          variance: 1e-3,
          amplitude: 0.26,
          sampleWindow: 2048,
          profileScores,
          timestampMs: 0,
        },
        preset,
        200 + frameIndex * 30,
      );
      expect(state.activeStringId).toBe("B3");
    }

    applyAnalysisFrame(
      state,
      {
        hz: 329.628,
        clarity: 0.96,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -32,
        onset: false,
        variance: 1e-3,
        amplitude: 0.26,
        sampleWindow: 2048,
        profileScores,
        timestampMs: 0,
      },
      preset,
      320,
    );

    expect(state.activeStringId).toBe("E4");
  });

  it("refuses to switch from B to high E when the detector reports the lower octave", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "B3";
    state.mode = "latched";

    for (let frameIndex = 0; frameIndex < 4; frameIndex += 1) {
      applyAnalysisFrame(
        state,
        {
          hz: 164.814,
          clarity: 0.93,
          rmsDb: -18,
          shortRmsDb: -18,
          slowRmsDb: -32,
          onset: false,
          variance: 1e-3,
          amplitude: 0.26,
          sampleWindow: 2048,
          profileScores: {
            E2: -32,
            A2: -28,
            D3: -24,
            G3: -18,
            B3: -15,
            E4: -4,
          },
          timestampMs: 0,
        },
        preset,
        200 + frameIndex * 40,
      );
    }

    expect(state.activeStringId).toBe("B3");
  });

  it("does not acquire low E from an octave-below string", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);

    for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) {
      applyAnalysisFrame(
        state,
        {
          hz: 41.2034,
          clarity: 0.96,
          rmsDb: -18,
          shortRmsDb: -18,
          slowRmsDb: -32,
          onset: frameIndex === 0,
          variance: 1e-3,
          amplitude: 0.26,
          sampleWindow: 4096,
          profileScores: {
            E2: -4,
            A2: -28,
            D3: -31,
            G3: -35,
            B3: -39,
            E4: -42,
          },
          timestampMs: 0,
        },
        preset,
        200 + frameIndex * 40,
      );
    }

    expect(state.activeStringId).toBeNull();
  });

  it("with manual target high E, refuses to switch to B even on B-like profile evidence", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    setManualTarget(state, preset, "E4", 0);

    for (let frameIndex = 0; frameIndex < 6; frameIndex += 1) {
      applyAnalysisFrame(
        state,
        {
          hz: 329.628,
          clarity: 0.96,
          rmsDb: -18,
          shortRmsDb: -18,
          slowRmsDb: -32,
          onset: false,
          variance: 1e-3,
          amplitude: 0.26,
          sampleWindow: 2048,
          profileScores: {
            E2: -45,
            A2: -42,
            D3: -38,
            G3: -22,
            B3: -3,
            E4: -18,
          },
          timestampMs: 0,
        },
        preset,
        200 + frameIndex * 40,
      );
    }

    expect(state.manualTargetStringId).toBe("E4");
    expect(state.activeStringId).toBe("E4");
  });

  it("low-confidence frames hold the previous active string and do not advance lock", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E4";
    state.mode = "latched";

    for (let frameIndex = 0; frameIndex < 5; frameIndex += 1) {
      applyAnalysisFrame(
        state,
        {
          hz: 329.628,
          clarity: 0.84,
          rmsDb: -50,
          shortRmsDb: -50,
          slowRmsDb: -55,
          onset: false,
          variance: 1e-3,
          amplitude: 0.05,
          sampleWindow: 2048,
          profileScores: {
            E2: -40,
            A2: -30,
            D3: -20,
            G3: -10,
            B3: -5,
            E4: -45,
          },
          timestampMs: 0,
        },
        preset,
        frameIndex * 300,
      );
    }

    expect(state.activeStringId).toBe("E4");
    expect(state.strings.E4.lockedInThisSession).toBe(false);
    expect(state.strings.E4.lockStartedMs).toBeNull();
  });

  it("holds high E through third-harmonic frames that resemble B", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E4";
    state.mode = "latched";

    for (let frameIndex = 0; frameIndex < 8; frameIndex += 1) {
      applyAnalysisFrame(
        state,
        {
          hz: 988.884,
          clarity: 0.94,
          rmsDb: -18,
          shortRmsDb: -18,
          slowRmsDb: -32,
          onset: false,
          variance: 1e-3,
          amplitude: 0.22,
          sampleWindow: 2048,
          profileScores: {
            E2: -40,
            A2: -37,
            D3: -31,
            G3: -24,
            B3: -6,
            E4: -11,
          },
          timestampMs: 0,
        },
        preset,
        200 + frameIndex * 40,
      );
    }

    expect(state.activeStringId).toBe("E4");
  });
});
