import { describe, expect, it } from "vitest";

import { findPitchYin } from "../../src/audio/dsp/yin";
import { makePluckSignal } from "./fixtures/signals";

const SR = 44_100;

function centsFrom(hz: number, ref: number): number {
  return 1200 * Math.log2(hz / ref);
}

describe("YIN pitch detection", () => {
  it("resolves low E (E2) stably with the long window", () => {
    const target = 82.4069;
    const signal = makePluckSignal(target, { length: 4096 });
    const result = findPitchYin(signal, SR);
    expect(Math.abs(centsFrom(result.hz, target))).toBeLessThan(8);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("resolves octave-below E1 instead of promoting it to low E", () => {
    const target = 41.2034;
    const signal = makePluckSignal(target, { length: 4096 });
    const result = findPitchYin(signal, SR);
    expect(Math.abs(centsFrom(result.hz, target))).toBeLessThan(12);
    expect(result.hz).toBeLessThan(50);
  });

  it("locks high E (E4) without slipping to B3 on a harmonic stack", () => {
    const target = 329.628;
    const signal = makePluckSignal(target, {
      length: 2048,
      harmonics: [0.42, 1, 0.78, 0.55, 0.34],
    });
    const result = findPitchYin(signal, SR);
    expect(Math.abs(centsFrom(result.hz, target))).toBeLessThan(15);
    // B3 is 246.94 Hz — make sure we did not slide that far.
    expect(result.hz).toBeGreaterThan(280);
  });

  it("recovers the fundamental of a missing-fundamental signal", () => {
    const target = 110;
    const length = 4096;
    const signal = new Float32Array(length);
    // No first harmonic; only 2x, 3x, 4x present.
    const harmonics = [0, 1, 0.6, 0.4];
    for (let i = 0; i < length; i += 1) {
      const t = i / SR;
      const env = Math.exp(-t * 3);
      let s = 0;
      harmonics.forEach((w, idx) => {
        s += w * Math.sin(2 * Math.PI * target * (idx + 1) * t);
      });
      signal[i] = s * env;
    }
    const result = findPitchYin(signal, SR);
    expect(Math.abs(centsFrom(result.hz, target))).toBeLessThan(20);
  });

  it("does not octave-drop on a bright signal (no half-frequency lock)", () => {
    const target = 196; // G3
    const signal = makePluckSignal(target, {
      length: 4096,
      harmonics: [1, 0.85, 0.65, 0.4, 0.25],
    });
    const result = findPitchYin(signal, SR);
    const cents = centsFrom(result.hz, target);
    expect(cents).toBeGreaterThan(-50);
    expect(cents).toBeLessThan(50);
  });
});
