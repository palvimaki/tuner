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

describe("target-aware pitch correction", () => {
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
