import { describe, expect, it } from "vitest";

import { scorePresetProfiles } from "../../src/audio/dsp/harmonic-profile";
import { resolveTargetAwarePitch } from "../../src/audio/dsp/target-aware";
import { computeDifference, cumulativeMeanNormalized, findPitchYin } from "../../src/audio/dsp/yin";
import { guitarPresets } from "../../src/domain/instruments/guitar/presets";
import { makePluckSignal } from "./fixtures/signals";

const SAMPLE_RATE = 44_100;

function cmndFor(signal: ArrayLike<number>): Float32Array {
  const maxTau = Math.min(signal.length >> 1, Math.ceil(SAMPLE_RATE / 55) + 2);
  return cumulativeMeanNormalized(computeDifference(signal, maxTau));
}

function standardTargets() {
  return guitarPresets[0].strings.map((stringDef) => ({ id: stringDef.id, hz: stringDef.hz }));
}

function targetsForPreset(presetId: string) {
  return guitarPresets
    .find((preset) => preset.id === presetId)!
    .strings.map((stringDef) => ({ id: stringDef.id, hz: stringDef.hz }));
}

function centsFrom(hz: number, ref: number): number {
  return 1200 * Math.log2(hz / ref);
}

function cmndWithTroughs(troughs: Array<{ hz: number; value: number }>): Float32Array {
  const cmnd = new Float32Array(900);
  cmnd.fill(0.95);
  for (const trough of troughs) {
    const tau = Math.round(SAMPLE_RATE / trough.hz);
    for (let offset = -2; offset <= 2; offset += 1) {
      cmnd[tau + offset] = trough.value + Math.abs(offset) * 0.015;
    }
  }
  return cmnd;
}

describe("target-aware pitch correction", () => {
  it("uses raw direct detector pitch for display when target search finds a biased trough", () => {
    const gHz = guitarPresets[0].strings.find((stringDef) => stringDef.id === "G3")!.hz;
    const biasedLocalHz = gHz * 2 ** (72 / 1200);
    const result = resolveTargetAwarePitch({
      rawHz: gHz,
      rawConfidence: 0.96,
      rawCmndAtTau: 0.04,
      cmnd: cmndWithTroughs([
        { hz: biasedLocalHz, value: 0.02 },
        { hz: gHz, value: 0.08 },
      ]),
      sampleRate: SAMPLE_RATE,
      targets: standardTargets(),
      profileScores: {
        E2: -38,
        A2: -30,
        D3: -20,
        G3: -4,
        B3: -22,
        E4: -35,
      },
    });

    expect(result.targetId).toBe("G3");
    expect(result.relation).toBe("direct");
    expect(Math.abs(centsFrom(result.hz, gHz))).toBeLessThan(5);
  });

  it("uses raw harmonic relation for display when low E identity used a biased local trough", () => {
    const lowEHz = 82.4069;
    const biasedLocalHz = lowEHz * 2 ** (35 / 1200);
    const result = resolveTargetAwarePitch({
      rawHz: lowEHz * 2,
      rawConfidence: 0.96,
      rawCmndAtTau: 0.04,
      cmnd: cmndWithTroughs([
        { hz: biasedLocalHz, value: 0.02 },
        { hz: lowEHz, value: 0.08 },
      ]),
      sampleRate: SAMPLE_RATE,
      targets: standardTargets(),
      profileScores: {
        E2: -4,
        A2: -22,
        D3: -28,
        G3: -33,
        B3: -38,
        E4: -45,
      },
    });

    expect(result.targetId).toBe("E2");
    expect(result.relation).toBe("harmonic");
    expect(result.relationMultiple).toBe(2);
    expect(Math.abs(centsFrom(result.hz, lowEHz))).toBeLessThan(5);
  });

  it("uses raw subharmonic relation for display when high E identity used a biased local trough", () => {
    const e4Hz = guitarPresets[0].strings.find((stringDef) => stringDef.id === "E4")!.hz;
    const biasedLocalHz = e4Hz * 2 ** (-35 / 1200);
    const result = resolveTargetAwarePitch({
      rawHz: e4Hz / 2,
      rawConfidence: 0.96,
      rawCmndAtTau: 0.04,
      cmnd: cmndWithTroughs([
        { hz: biasedLocalHz, value: 0.02 },
      ]),
      sampleRate: SAMPLE_RATE,
      targets: standardTargets(),
      profileScores: {
        E2: -45,
        A2: -38,
        D3: -32,
        G3: -25,
        B3: -18,
        E4: -4,
      },
    });

    expect(result.targetId).toBe("E4");
    expect(result.relation).toBe("subharmonic");
    expect(result.relationMultiple).toBe(2);
    expect(Math.abs(centsFrom(result.hz, e4Hz))).toBeLessThan(5);
  });

  it("keeps genuine low-E harmonic detune visible instead of snapping to center", () => {
    const lowEHz = 82.4069;
    const sharpLowEHz = lowEHz * 2 ** (50 / 1200);
    const result = resolveTargetAwarePitch({
      rawHz: sharpLowEHz * 2,
      rawConfidence: 0.96,
      rawCmndAtTau: 0.04,
      cmnd: cmndWithTroughs([
        { hz: sharpLowEHz, value: 0.02 },
        { hz: lowEHz, value: 0.2 },
      ]),
      sampleRate: SAMPLE_RATE,
      targets: standardTargets(),
      profileScores: {
        E2: -4,
        A2: -22,
        D3: -28,
        G3: -33,
        B3: -38,
        E4: -45,
      },
    });

    expect(result.targetId).toBe("E2");
    expect(result.relation).toBe("harmonic");
    expect(result.relationMultiple).toBe(2);
    expect(centsFrom(result.hz, lowEHz)).toBeGreaterThan(45);
    expect(centsFrom(result.hz, lowEHz)).toBeLessThan(55);
  });

  it("does not steal an ambiguous low-E third-harmonic hit from direct B3", () => {
    const preset = guitarPresets[0];
    const lowEHz = 82.4069;
    const signal = makePluckSignal(lowEHz, {
      length: 4_096,
      harmonics: [0.16, 0.42, 1, 0.28],
    });
    const raw = findPitchYin(signal, SAMPLE_RATE);
    const result = resolveTargetAwarePitch({
      rawHz: lowEHz * 3,
      rawConfidence: raw.confidence,
      rawCmndAtTau: raw.cmndAtTau,
      cmnd: cmndFor(signal),
      sampleRate: SAMPLE_RATE,
      targets: standardTargets(),
      profileScores: scorePresetProfiles(signal, SAMPLE_RATE, preset),
    });

    expect(result.targetId).toBe("B3");
    expect(result.relation).toBe("direct");
  });

  it("keeps direct B3 ahead of the lower E2 subharmonic explanation", () => {
    const preset = guitarPresets[0];
    const bHz = preset.strings.find((stringDef) => stringDef.id === "B3")!.hz;
    const signal = makePluckSignal(bHz, {
      length: 4_096,
      harmonics: [1, 0.42, 0.24, 0.16],
    });
    const raw = findPitchYin(signal, SAMPLE_RATE);
    const result = resolveTargetAwarePitch({
      rawHz: bHz,
      rawConfidence: raw.confidence,
      rawCmndAtTau: raw.cmndAtTau,
      cmnd: cmndFor(signal),
      sampleRate: SAMPLE_RATE,
      targets: standardTargets(),
      profileScores: scorePresetProfiles(signal, SAMPLE_RATE, preset),
    });

    expect(result.targetId).toBe("B3");
    expect(result.relation).toBe("direct");
    expect(Math.abs(result.hz - bHz)).toBeLessThan(1.5);
  });

  it("corrects a high-E octave-down detector hit back to E4 when the profile is E4", () => {
    const preset = guitarPresets[0];
    const e4Hz = preset.strings.find((stringDef) => stringDef.id === "E4")!.hz;
    const signal = makePluckSignal(e4Hz, {
      length: 2_048,
      harmonics: [0.42, 1, 0.78, 0.55, 0.34],
    });
    const raw = findPitchYin(signal, SAMPLE_RATE);
    const result = resolveTargetAwarePitch({
      rawHz: e4Hz / 2,
      rawConfidence: raw.confidence,
      rawCmndAtTau: raw.cmndAtTau,
      cmnd: cmndFor(signal),
      sampleRate: SAMPLE_RATE,
      targets: standardTargets(),
      profileScores: scorePresetProfiles(signal, SAMPLE_RATE, preset),
    });

    expect(result.targetId).toBe("E4");
    expect(result.relation).toBe("subharmonic");
    expect(Math.abs(result.hz - e4Hz)).toBeLessThan(2);
  });

  it("keeps Open D D4 ahead of the repeated D3 direct explanation", () => {
    const preset = guitarPresets.find((entry) => entry.id === "open-d")!;
    const d4Hz = preset.strings.find((stringDef) => stringDef.id === "D4")!.hz;
    const signal = makePluckSignal(d4Hz, {
      length: 2_048,
      harmonics: [0.42, 1, 0.78, 0.55, 0.34],
    });
    const raw = findPitchYin(signal, SAMPLE_RATE);
    const result = resolveTargetAwarePitch({
      rawHz: d4Hz / 2,
      rawConfidence: raw.confidence,
      rawCmndAtTau: raw.cmndAtTau,
      cmnd: cmndFor(signal),
      sampleRate: SAMPLE_RATE,
      targets: targetsForPreset("open-d"),
      profileScores: scorePresetProfiles(signal, SAMPLE_RATE, preset),
    });

    expect(result.targetId).toBe("D4");
    expect(result.relation).toBe("subharmonic");
    expect(Math.abs(result.hz - d4Hz)).toBeLessThan(2);
  });
});
