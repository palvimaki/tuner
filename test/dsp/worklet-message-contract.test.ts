import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const SAMPLE_RATE = 44_100;
const LOW_E_HZ = 82.4069;
const B3_HZ = 246.9417;
const D4_HZ = 293.6648;
const E4_HZ = 329.6276;

function makePluck(frequency: number, seconds: number, harmonics: readonly number[]): Float32Array {
  const length = Math.floor(SAMPLE_RATE * seconds);
  const signal = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-t * 1.8);
    let sample = 0;
    harmonics.forEach((weight, index) => {
      sample += weight * Math.sin(2 * Math.PI * frequency * (index + 1) * t);
    });
    signal[i] = sample * envelope * 0.12;
  }
  return signal;
}

function makeCmndWithMinimum(hz: number): Float32Array {
  const cmnd = new Float32Array(900);
  cmnd.fill(0.95);
  const tau = Math.round(SAMPLE_RATE / hz);
  for (let offset = -3; offset <= 3; offset += 1) {
    cmnd[tau + offset] = 0.02 + Math.abs(offset) * 0.01;
  }
  return cmnd;
}

describe("production worklet frame contract", () => {
  it("posts corrected F0 in frame.hz and raw detector output in frame.rawHz", () => {
    let ProcessorClass!: new (options: unknown) => {
      process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
    };
    const posted: unknown[] = [];
    const context = {
      console,
      sampleRate: SAMPLE_RATE,
      currentTime: 0,
      AudioWorkletProcessor: class {
        port = { postMessage: (message: unknown) => posted.push(message), onmessage: null };
      },
      registerProcessor: (_name: string, cls: typeof ProcessorClass) => {
        ProcessorClass = cls;
      },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("public/worklets/tuner-processor.js", "utf8"), context);

    const cmnd = makeCmndWithMinimum(E4_HZ);
    (context as typeof context & { findPitchYIN: unknown }).findPitchYIN = () => ({
      hz: E4_HZ * 2,
      confidence: 0.96,
      cmndAtTau: 0.04,
      cmnd,
    });

    const targets = [
      ["E2", 82.4069],
      ["A2", 110],
      ["D3", 146.8324],
      ["G3", 195.9977],
      ["B3", 246.9417],
      ["E4", 329.6276],
    ].map(([id, hz]) => ({ id, hz }));
    const processor = new ProcessorClass({
      processorOptions: { targets, onsetThresholdDb: 8, onsetDebounceMs: 140 },
    });
    const signal = makePluck(E4_HZ, 1.2, [0.42, 1, 0.78, 0.55, 0.34]);
    const output = new Float32Array(128);

    for (let offset = 0; offset + 128 <= signal.length; offset += 128) {
      context.currentTime = offset / SAMPLE_RATE;
      processor.process([[signal.slice(offset, offset + 128)]], [[output]]);
    }

    const stableFrames = posted
      .map((frame) => frame as { hz: number; rawHz: number; stableTail?: boolean; debug?: { targetStringId?: string } })
      .filter((frame) => frame.stableTail);
    const last = stableFrames.at(-1);

    expect(last).toBeDefined();
    expect(last?.debug?.targetStringId).toBe("E4");
    expect(Math.abs((last?.hz ?? 0) - E4_HZ)).toBeLessThan(1.5);
    expect(Math.abs((last?.rawHz ?? 0) - E4_HZ * 2)).toBeLessThan(1.5);
  });

  it("does not mark corrected frames stable while raw detector octaves alternate", () => {
    let ProcessorClass!: new (options: unknown) => {
      process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
    };
    const posted: unknown[] = [];
    const context = {
      console,
      sampleRate: SAMPLE_RATE,
      currentTime: 0,
      AudioWorkletProcessor: class {
        port = { postMessage: (message: unknown) => posted.push(message), onmessage: null };
      },
      registerProcessor: (_name: string, cls: typeof ProcessorClass) => {
        ProcessorClass = cls;
      },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("public/worklets/tuner-processor.js", "utf8"), context);

    const cmnd = makeCmndWithMinimum(E4_HZ);
    let calls = 0;
    (context as typeof context & { findPitchYIN: unknown }).findPitchYIN = () => {
      const frameIndex = Math.floor(calls / 2);
      calls += 1;
      return {
        hz: frameIndex % 2 === 0 ? E4_HZ : E4_HZ * 2,
        confidence: 0.96,
        cmndAtTau: 0.04,
        cmnd,
      };
    };

    const targets = [
      ["E2", 82.4069],
      ["A2", 110],
      ["D3", 146.8324],
      ["G3", 195.9977],
      ["B3", B3_HZ],
      ["E4", E4_HZ],
    ].map(([id, hz]) => ({ id, hz }));
    const processor = new ProcessorClass({
      processorOptions: { targets, onsetThresholdDb: 8, onsetDebounceMs: 140 },
    });
    const signal = makePluck(E4_HZ, 1.2, [0.42, 1, 0.78, 0.55, 0.34]);
    const output = new Float32Array(128);

    for (let offset = 0; offset + 128 <= signal.length; offset += 128) {
      context.currentTime = offset / SAMPLE_RATE;
      processor.process([[signal.slice(offset, offset + 128)]], [[output]]);
    }

    const stableFrames = posted
      .map((frame) => frame as { hz: number; rawHz: number; stableTail?: boolean; debug?: { targetStringId?: string } })
      .filter((frame) => frame.stableTail);
    const correctedFrames = posted
      .map((frame) => frame as { hz: number; debug?: { targetStringId?: string } })
      .filter((frame) => frame.debug?.targetStringId === "E4");

    expect(correctedFrames.length).toBeGreaterThan(0);
    expect(stableFrames).toHaveLength(0);
  });

  it("keeps a direct B3 pluck from being retargeted to low E", () => {
    let ProcessorClass!: new (options: unknown) => {
      process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
    };
    const posted: unknown[] = [];
    const context = {
      console,
      sampleRate: SAMPLE_RATE,
      currentTime: 0,
      AudioWorkletProcessor: class {
        port = { postMessage: (message: unknown) => posted.push(message), onmessage: null };
      },
      registerProcessor: (_name: string, cls: typeof ProcessorClass) => {
        ProcessorClass = cls;
      },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("public/worklets/tuner-processor.js", "utf8"), context);

    const targets = [
      ["E2", 82.4069],
      ["A2", 110],
      ["D3", 146.8324],
      ["G3", 195.9977],
      ["B3", B3_HZ],
      ["E4", E4_HZ],
    ].map(([id, hz]) => ({ id, hz }));
    const processor = new ProcessorClass({
      processorOptions: { targets, onsetThresholdDb: 8, onsetDebounceMs: 140 },
    });
    const signal = makePluck(B3_HZ, 1.2, [0.613, 0.12, 0.164, 0.79, 0.337]);
    const output = new Float32Array(128);

    for (let offset = 0; offset + 128 <= signal.length; offset += 128) {
      context.currentTime = offset / SAMPLE_RATE;
      processor.process([[signal.slice(offset, offset + 128)]], [[output]]);
    }

    const stableFrames = posted
      .map((frame) => frame as { hz: number; stableTail?: boolean; debug?: { targetStringId?: string } })
      .filter((frame) => frame.stableTail);
    const last = stableFrames.at(-1);

    expect(last).toBeDefined();
    expect(last?.debug?.targetStringId).toBe("B3");
    expect(Math.abs((last?.hz ?? 0) - B3_HZ)).toBeLessThan(1.5);
  });

  it("keeps repeated-note Open D D4 ahead of a D3 direct explanation", () => {
    let ProcessorClass!: new (options: unknown) => {
      process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
    };
    const posted: unknown[] = [];
    const context = {
      console,
      sampleRate: SAMPLE_RATE,
      currentTime: 0,
      AudioWorkletProcessor: class {
        port = { postMessage: (message: unknown) => posted.push(message), onmessage: null };
      },
      registerProcessor: (_name: string, cls: typeof ProcessorClass) => {
        ProcessorClass = cls;
      },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync("public/worklets/tuner-processor.js", "utf8"), context);

    const cmnd = makeCmndWithMinimum(D4_HZ);
    (context as typeof context & { findPitchYIN: unknown }).findPitchYIN = () => ({
      hz: D4_HZ / 2,
      confidence: 0.96,
      cmndAtTau: 0.04,
      cmnd,
    });

    const targets = [
      ["D2", 73.4162],
      ["A2", 110],
      ["D3", 146.8324],
      ["F#3", 184.9972],
      ["A3", 220],
      ["D4", D4_HZ],
    ].map(([id, hz]) => ({ id, hz }));
    const processor = new ProcessorClass({
      processorOptions: { targets, onsetThresholdDb: 8, onsetDebounceMs: 140 },
    });
    const signal = makePluck(D4_HZ, 1.2, [0.42, 1, 0.78, 0.55, 0.34]);
    const output = new Float32Array(128);

    for (let offset = 0; offset + 128 <= signal.length; offset += 128) {
      context.currentTime = offset / SAMPLE_RATE;
      processor.process([[signal.slice(offset, offset + 128)]], [[output]]);
    }

    const stableFrames = posted
      .map((frame) => frame as { hz: number; stableTail?: boolean; debug?: { targetStringId?: string } })
      .filter((frame) => frame.stableTail);
    const last = stableFrames.at(-1);

    expect(last).toBeDefined();
    expect(last?.debug?.targetStringId).toBe("D4");
    expect(Math.abs((last?.hz ?? 0) - D4_HZ)).toBeLessThan(1.5);
  });
});
