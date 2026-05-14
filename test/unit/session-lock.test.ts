import { describe, expect, it } from "vitest";

import { applyAnalysisFrame, createInitialState, setManualTarget } from "../../src/app/state";
import { guitarPresets } from "../../src/domain/instruments/guitar/presets";

function hzAtCents(targetHz: number, cents: number): number {
  return targetHz * 2 ** (cents / 1200);
}

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

  it("locks high E when the worklet corrected octave-shifted harmonic frames", () => {
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

    applyAnalysisFrame(state, { ...frame, hz: 329.628, rawHz: 659.256 }, preset, 0);
    const effect = applyAnalysisFrame(state, { ...frame, hz: 329.628, rawHz: 659.256 }, preset, 1_050);

    expect(effect.lockedStringId).toBe("E4");
    expect(state.strings.E4.lockedInThisSession).toBe(true);
    expect(state.strings.E4.lockedAtMs).toBe(1_050);
  });

  it("lets low E settle through realistic low-string cents drift", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E2";
    state.mode = "latched";
    const targetHz = 82.4069;
    const frame = {
      clarity: 0.98,
      confidence: 0.94,
      rmsDb: -17,
      shortRmsDb: -17,
      slowRmsDb: -30,
      onset: false,
      variance: 1e-3,
      amplitude: 0.2,
      sampleWindow: 4096 as const,
      profileScores: {
        E2: -6,
        A2: -21,
        D3: -27,
        G3: -31,
        B3: -35,
        E4: -40,
      },
      stableTail: true,
      timestampMs: 0,
    };

    applyAnalysisFrame(state, { ...frame, hz: hzAtCents(targetHz, 10.5) }, preset, 0);
    applyAnalysisFrame(state, { ...frame, hz: hzAtCents(targetHz, 9.8) }, preset, 520);
    const effect = applyAnalysisFrame(
      state,
      { ...frame, hz: hzAtCents(targetHz, 10.2) },
      preset,
      1_080,
    );

    expect(effect.lockedStringId).toBe("E2");
    expect(state.strings.E2.lockedInThisSession).toBe(true);
  });

  it("keeps the tighter settle gate on high E", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E4";
    state.mode = "latched";
    const targetHz = 329.628;
    const frame = {
      clarity: 0.98,
      confidence: 0.94,
      rmsDb: -17,
      shortRmsDb: -17,
      slowRmsDb: -30,
      onset: false,
      variance: 1e-3,
      amplitude: 0.2,
      sampleWindow: 2048 as const,
      profileScores: {
        E2: -40,
        A2: -37,
        D3: -30,
        G3: -22,
        B3: -12,
        E4: -4,
      },
      stableTail: true,
      timestampMs: 0,
    };

    applyAnalysisFrame(state, { ...frame, hz: hzAtCents(targetHz, 10.5) }, preset, 0);
    applyAnalysisFrame(state, { ...frame, hz: hzAtCents(targetHz, 9.8) }, preset, 520);
    const effect = applyAnalysisFrame(
      state,
      { ...frame, hz: hzAtCents(targetHz, 10.2) },
      preset,
      1_080,
    );

    expect(effect.lockedStringId).toBeNull();
    expect(state.strings.E4.lockedInThisSession).toBe(false);
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

  it("requires consecutive stable in-tolerance frames before locking", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E4";
    state.mode = "latched";
    const baseFrame = {
      hz: 329.628,
      clarity: 0.97,
      rmsDb: -16,
      shortRmsDb: -16,
      slowRmsDb: -30,
      onset: false as const,
      variance: 1e-3,
      amplitude: 0.2,
      sampleWindow: 2048 as const,
      profileScores: {
        E2: -40,
        A2: -37,
        D3: -30,
        G3: -22,
        B3: -12,
        E4: -4,
      },
      timestampMs: 0,
    };

    // Single in-tune frame is not enough even after the lock duration.
    const onlyOne = applyAnalysisFrame(state, baseFrame, preset, 0);
    expect(onlyOne.lockedStringId).toBeNull();
    expect(state.strings.E4.lockedInThisSession).toBe(false);

    // Two frames within the lock window also do not lock yet.
    const earlySecond = applyAnalysisFrame(state, baseFrame, preset, 200);
    expect(earlySecond.lockedStringId).toBeNull();
    expect(state.strings.E4.lockedInThisSession).toBe(false);

    // Third frame past the timing gate locks.
    const finalEffect = applyAnalysisFrame(state, baseFrame, preset, 1_200);
    expect(finalEffect.lockedStringId).toBe("E4");
  });

  it("transient-suppressed frames do not start the lock timer", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
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
        onset: true,
        variance: 1e-3,
        amplitude: 0.4,
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
        transientSuppressed: true,
      },
      preset,
      0,
    );

    expect(state.strings.E4.lockStartedMs).toBeNull();
    expect(state.strings.E4.lockedInThisSession).toBe(false);
  });

  it("requires stable-tail frames before locking when the worklet provides the flag", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E4";
    state.mode = "latched";
    const frame = {
      hz: 329.628,
      clarity: 0.98,
      confidence: 0.94,
      rmsDb: -16,
      shortRmsDb: -16,
      slowRmsDb: -30,
      onset: false,
      variance: 1e-3,
      amplitude: 0.2,
      sampleWindow: 2048 as const,
      profileScores: {
        E2: -40,
        A2: -37,
        D3: -30,
        G3: -22,
        B3: -12,
        E4: -4,
      },
      timestampMs: 0,
    };

    applyAnalysisFrame(state, { ...frame, stableTail: false }, preset, 0);
    const unstable = applyAnalysisFrame(state, { ...frame, stableTail: false }, preset, 1_200);
    expect(unstable.lockedStringId).toBeNull();
    expect(state.strings.E4.lockedInThisSession).toBe(false);

    applyAnalysisFrame(state, { ...frame, stableTail: true }, preset, 1_260);
    const stable = applyAnalysisFrame(state, { ...frame, stableTail: true }, preset, 2_300);
    expect(stable.lockedStringId).toBe("E4");
  });

  it("corrected octave-shifted harmonic frames can tune the latched manual target without changing identity", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    setManualTarget(state, preset, "E4", 0);

    const frame = {
      hz: 329.628,
      rawHz: 659.256,
      clarity: 0.96,
      rmsDb: -16,
      shortRmsDb: -16,
      slowRmsDb: -30,
      onset: false as const,
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

    applyAnalysisFrame(state, frame, preset, 250);
    const effect = applyAnalysisFrame(state, frame, preset, 1_350);

    expect(state.activeStringId).toBe("E4");
    expect(effect.lockedStringId).toBe("E4");
  });

  it("admits moderate-confidence corrected harmonic frames without dropping the active string", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E4";
    state.mode = "latched";
    state.lastGoodFrameAtMs = 0;

    const effect = applyAnalysisFrame(
      state,
      {
        hz: 329.628,
        rawHz: 659.256,
        clarity: 0.56,
        confidence: 0.56,
        rmsDb: -17,
        shortRmsDb: -17,
        slowRmsDb: -30,
        onset: false,
        variance: 1e-3,
        amplitude: 0.2,
        sampleWindow: 2048,
        profileScores: {
          E2: -33,
          A2: -28,
          D3: -24,
          G3: -18,
          B3: -14,
          E4: -4,
        },
        stableTail: true,
        debug: {
          targetStringId: "E4",
          targetRelation: "subharmonic",
          targetRelationMultiple: 2,
        },
        timestampMs: 0,
      },
      preset,
      3_000,
    );

    expect(effect.lockedStringId).toBeNull();
    expect(state.activeStringId).toBe("E4");
    expect(state.lastGoodFrameAtMs).toBe(3_000);
    expect(Math.abs(state.strings.E4.cents ?? Infinity)).toBeLessThan(1);
  });

  it("clears stale active strings on ordinary low-confidence frames", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E4";
    state.mode = "latched";
    state.lastGoodFrameAtMs = 0;

    applyAnalysisFrame(
      state,
      {
        hz: 329.628,
        clarity: 0.56,
        confidence: 0.56,
        rmsDb: -17,
        shortRmsDb: -17,
        slowRmsDb: -30,
        onset: false,
        variance: 1e-3,
        amplitude: 0.2,
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
      3_000,
    );

    expect(state.activeStringId).toBeNull();
    expect(state.mode).toBe("probing");
    expect(state.lastGoodFrameAtMs).toBe(0);
  });

  it("does not let rejected low-confidence pitch artifacts move the visible dot", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E2";
    state.mode = "latched";

    applyAnalysisFrame(
      state,
      {
        hz: 82.4069,
        clarity: 0.96,
        confidence: 0.96,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -32,
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
        stableTail: true,
        timestampMs: 0,
      },
      preset,
      0,
    );

    const centered = state.strings.E2.cents;
    applyAnalysisFrame(
      state,
      {
        hz: hzAtCents(82.4069, 95),
        clarity: 0.52,
        confidence: 0.52,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -32,
        onset: false,
        variance: 1e-3,
        amplitude: 0.18,
        sampleWindow: 4096,
        profileScores: {
          E2: -6,
          A2: -20,
          D3: -26,
          G3: -30,
          B3: -34,
          E4: -39,
        },
        stableTail: true,
        timestampMs: 0,
      },
      preset,
      100,
    );

    expect(Math.abs(centered ?? Infinity)).toBeLessThan(1);
    expect(Math.abs(state.strings.E2.cents ?? Infinity)).toBeLessThan(1);
    expect(Math.abs(state.strings.E2.instantCents ?? Infinity)).toBeLessThan(1);
  });

  it("does not let transient-suppressed attack frames move the visible dot", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E2";
    state.mode = "latched";

    applyAnalysisFrame(
      state,
      {
        hz: 82.4069,
        clarity: 0.96,
        confidence: 0.96,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -32,
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
        stableTail: true,
        timestampMs: 0,
      },
      preset,
      0,
    );

    applyAnalysisFrame(
      state,
      {
        hz: hzAtCents(82.4069, 95),
        clarity: 0.98,
        confidence: 0.98,
        rmsDb: -16,
        shortRmsDb: -16,
        slowRmsDb: -32,
        onset: true,
        variance: 1e-3,
        amplitude: 0.4,
        sampleWindow: 4096,
        profileScores: {
          E2: -6,
          A2: -20,
          D3: -26,
          G3: -30,
          B3: -34,
          E4: -39,
        },
        stableTail: false,
        transientSuppressed: true,
        timestampMs: 0,
      },
      preset,
      120,
    );

    expect(Math.abs(state.strings.E2.cents ?? Infinity)).toBeLessThan(1);
    expect(Math.abs(state.strings.E2.instantCents ?? Infinity)).toBeLessThan(1);
  });

  it("clears stale pitch state when silence clears the active string", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E2";
    state.mode = "latched";

    applyAnalysisFrame(
      state,
      {
        hz: 82.4069,
        clarity: 0.96,
        confidence: 0.96,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -32,
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
        stableTail: true,
        timestampMs: 0,
      },
      preset,
      0,
    );

    applyAnalysisFrame(
      state,
      {
        hz: 0,
        clarity: 0,
        confidence: 0,
        rmsDb: -80,
        shortRmsDb: -80,
        slowRmsDb: -80,
        onset: false,
        variance: 0,
        amplitude: 0,
        sampleWindow: 4096,
        profileScores: {},
        timestampMs: 0,
      },
      preset,
      2_600,
    );

    expect(state.activeStringId).toBeNull();
    for (const stringState of Object.values(state.strings)) {
      expect(stringState.rawCents).toBeNull();
      expect(stringState.instantCents).toBeNull();
      expect(stringState.cents).toBeNull();
      expect(stringState.pitchPenaltyCents).toBe(0);
    }
  });

  it("acquires the next string on onset after silence cleared stale pitch state", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "E2";
    state.mode = "latched";

    applyAnalysisFrame(
      state,
      {
        hz: 82.4069,
        clarity: 0.96,
        confidence: 0.96,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -32,
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
        stableTail: true,
        timestampMs: 0,
      },
      preset,
      0,
    );

    applyAnalysisFrame(
      state,
      {
        hz: 0,
        clarity: 0,
        confidence: 0,
        rmsDb: -80,
        shortRmsDb: -80,
        slowRmsDb: -80,
        onset: false,
        variance: 0,
        amplitude: 0,
        sampleWindow: 4096,
        profileScores: {},
        timestampMs: 0,
      },
      preset,
      2_600,
    );

    applyAnalysisFrame(
      state,
      {
        hz: 110,
        clarity: 0.98,
        confidence: 0.98,
        rmsDb: -16,
        shortRmsDb: -16,
        slowRmsDb: -32,
        onset: true,
        variance: 1e-3,
        amplitude: 0.35,
        sampleWindow: 4096,
        profileScores: {
          E2: -28,
          A2: -6,
          D3: -24,
          G3: -30,
          B3: -34,
          E4: -39,
        },
        stableTail: false,
        transientSuppressed: true,
        timestampMs: 0,
      },
      preset,
      2_760,
    );

    expect(state.activeStringId).toBe("A2");
  });

  it("clears stale cents when a locked string hands off on a new onset", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "G3";
    state.mode = "latched";
    state.strings.G3.lockedInThisSession = true;

    applyAnalysisFrame(
      state,
      {
        hz: 195.9977,
        clarity: 0.96,
        confidence: 0.96,
        rmsDb: -18,
        shortRmsDb: -18,
        slowRmsDb: -32,
        onset: false,
        variance: 1e-3,
        amplitude: 0.2,
        sampleWindow: 4096,
        profileScores: {
          E2: -34,
          A2: -28,
          D3: -20,
          G3: -6,
          B3: -20,
          E4: -30,
        },
        stableTail: true,
        timestampMs: 0,
      },
      preset,
      0,
    );

    expect(state.strings.D3.cents ?? 0).toBeGreaterThan(400);

    applyAnalysisFrame(
      state,
      {
        hz: 146.8324,
        clarity: 0.96,
        confidence: 0.96,
        rmsDb: -17,
        shortRmsDb: -17,
        slowRmsDb: -32,
        onset: true,
        variance: 1e-3,
        amplitude: 0.35,
        sampleWindow: 4096,
        profileScores: {
          E2: -32,
          A2: -24,
          D3: -6,
          G3: -22,
          B3: -31,
          E4: -38,
        },
        stableTail: false,
        transientSuppressed: true,
        debug: {
          targetStringId: "D3",
          targetRelation: "direct",
          targetRelationMultiple: 1,
        },
        timestampMs: 0,
      },
      preset,
      220,
    );

    expect(state.activeStringId).toBe("D3");
    expect(state.strings.D3.cents).toBeNull();
    expect(state.strings.D3.instantCents).toBeNull();
  });

  it("clears stale cents when challenger switching hands off without an onset", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.activeStringId = "G3";
    state.mode = "latched";
    state.strings.G3.lockedInThisSession = true;

    const frame = {
      hz: 146.8324,
      clarity: 0.98,
      confidence: 0.98,
      rmsDb: -17,
      shortRmsDb: -17,
      slowRmsDb: -32,
      onset: false,
      variance: 1e-3,
      amplitude: 0.3,
      sampleWindow: 4096 as const,
      profileScores: {
        E2: -32,
        A2: -24,
        D3: -6,
        G3: -22,
        B3: -31,
        E4: -38,
      },
      stableTail: true,
      debug: {
        targetStringId: "D3",
        targetRelation: "direct" as const,
        targetRelationMultiple: 1,
      },
      timestampMs: 0,
    };

    applyAnalysisFrame(state, frame, preset, 200);
    applyAnalysisFrame(state, frame, preset, 220);
    applyAnalysisFrame(state, frame, preset, 240);
    applyAnalysisFrame(state, frame, preset, 260);

    expect(state.activeStringId).toBe("D3");
    expect(state.strings.D3.cents).toBeNull();
    expect(state.strings.D3.instantCents).toBeNull();
    expect(state.strings.G3.lockedInThisSession).toBe(true);
  });

  it("starts a fresh lock session on the next onset after completion", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.mode = "completed";
    state.activeStringId = "E4";
    state.completedAtMs = 1_000;
    for (const stringDef of preset.strings) {
      state.strings[stringDef.id].lockedInThisSession = true;
      state.strings[stringDef.id].lockedAtMs = 900;
    }

    applyAnalysisFrame(
      state,
      {
        hz: 82.4069,
        clarity: 0.96,
        confidence: 0.96,
        rmsDb: -17,
        shortRmsDb: -17,
        slowRmsDb: -32,
        onset: true,
        variance: 1e-3,
        amplitude: 0.35,
        sampleWindow: 4096,
        profileScores: {
          E2: -6,
          A2: -20,
          D3: -26,
          G3: -30,
          B3: -34,
          E4: -39,
        },
        stableTail: false,
        transientSuppressed: true,
        debug: {
          targetStringId: "E2",
          targetRelation: "direct",
          targetRelationMultiple: 1,
        },
        timestampMs: 0,
      },
      preset,
      1_800,
    );

    expect(state.completedAtMs).toBeNull();
    expect(state.mode).toBe("latched");
    expect(state.activeStringId).toBe("E2");
    expect(state.strings.E2.lockedInThisSession).toBe(false);
    expect(state.strings.A2.lockedInThisSession).toBe(false);
  });

  it("starts a fresh lock session after completion even when the next pluck misses onset", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    state.mode = "completed";
    state.activeStringId = "E4";
    state.completedAtMs = 1_000;
    for (const stringDef of preset.strings) {
      state.strings[stringDef.id].lockedInThisSession = true;
      state.strings[stringDef.id].lockedAtMs = 900;
    }

    const frame = {
      hz: 82.4069,
      clarity: 0.96,
      confidence: 0.96,
      rmsDb: -17,
      shortRmsDb: -17,
      slowRmsDb: -32,
      onset: false,
      variance: 1e-3,
      amplitude: 0.35,
      sampleWindow: 4096 as const,
      profileScores: {
        E2: -6,
        A2: -20,
        D3: -26,
        G3: -30,
        B3: -34,
        E4: -39,
      },
      stableTail: true,
      debug: {
        targetStringId: "E2",
        targetRelation: "direct" as const,
        targetRelationMultiple: 1,
      },
      timestampMs: 0,
    };

    applyAnalysisFrame(state, frame, preset, 1_800);

    expect(state.completedAtMs).toBeNull();
    expect(state.mode).toBe("probing");
    expect(state.activeStringId).toBeNull();
    expect(state.probeStringId).toBe("E2");
    expect(state.strings.E2.lockedInThisSession).toBe(false);
    expect(state.strings.A2.lockedInThisSession).toBe(false);

    applyAnalysisFrame(state, frame, preset, 1_820);
    expect(state.activeStringId).toBe("E2");
  });

  it("does not lock an uncorrected harmonic as if it were the target F0", () => {
    const preset = guitarPresets[0];
    const state = createInitialState(preset);
    setManualTarget(state, preset, "E4", 0);

    const frame = {
      hz: 659.256,
      rawHz: 659.256,
      clarity: 0.96,
      rmsDb: -16,
      shortRmsDb: -16,
      slowRmsDb: -30,
      onset: false as const,
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
      stableTail: true,
      timestampMs: 0,
    };

    applyAnalysisFrame(state, frame, preset, 250);
    const effect = applyAnalysisFrame(state, frame, preset, 1_350);

    expect(effect.lockedStringId).toBeNull();
    expect(state.strings.E4.lockedInThisSession).toBe(false);
    expect(Math.abs(state.strings.E4.cents ?? 0)).toBeGreaterThan(1_100);
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
