import { describe, expect, it } from "vitest";

import {
  detectRuntimeCapabilities,
  type CapabilityCheck,
  type IIP,
  type ModelManifest,
  type PitchEngine,
  type PitchEngineConfig,
  type PolyphonicAnalyzer,
  type StringClassifier,
} from "../../src/domain/iip";

describe("IIP contracts", () => {
  it("accepts a representative pitch engine implementation", () => {
    const engine: PitchEngine = {
      id: "stub-mpm",
      kind: "mpm",
      version: "0.0.1",
      init(_cfg: PitchEngineConfig) {},
      process(frame) {
        return frame.length > 0
          ? { hz: 440, confidence: 0.9, timestamp: 0, clarity: 0.95 }
          : null;
      },
    };
    const estimate = engine.process(new Float32Array(16));
    expect(estimate?.hz).toBe(440);
  });

  it("accepts a string classifier", () => {
    const classifier: StringClassifier = {
      id: "stub-classifier",
      version: "0.0.1",
      classify(input, candidates) {
        return candidates.length > 0
          ? { stringId: candidates[0]!, confidence: input.pitchHz > 0 ? 1 : 0 }
          : null;
      },
    };
    expect(classifier.classify({ pitchHz: 82.4 }, ["E2", "A2"])?.stringId).toBe("E2");
  });

  it("describes a model manifest", () => {
    const manifest: ModelManifest = {
      id: "pitch-crepe-tiny",
      kind: "pitch",
      version: "1.0.0",
      runtime: "onnx-webgpu",
      assetUrl: "/models/crepe-tiny.json",
      capabilities: { polyphonic: false, maxVoices: 1 },
    };
    expect(manifest.runtime).toBe("onnx-webgpu");
  });

  it("accepts a polyphonic analyzer contract", () => {
    const poly: PolyphonicAnalyzer = {
      id: "stub-poly",
      version: "0.0.1",
      maxVoices: 6,
      init() {},
      process() {
        return { voices: [], timestamp: 0 };
      },
    };
    expect(poly.maxVoices).toBe(6);
  });

  it("supports capability checks against detected runtime", () => {
    const caps = detectRuntimeCapabilities({});
    expect(caps.audioWorklet).toBe(false);
    expect(caps.wasm).toBe(false);
    expect(caps.webgpu).toBe(false);
    expect(caps.webnn).toBe(false);

    const browserCaps = detectRuntimeCapabilities({
      navigator: { gpu: {}, ml: {} },
      WebAssembly: {},
    });
    expect(browserCaps.webgpu).toBe(true);
    expect(browserCaps.webnn).toBe(true);

    const check: CapabilityCheck = {
      id: "needs-worklet",
      describe: () => "Requires AudioWorklet",
      check: (env) => Boolean(env?.audioWorklet),
    };
    expect(check.check(caps)).toBe(false);
    expect(check.check({ audioWorklet: true })).toBe(true);
  });

  it("treats IIP as a register-only contract", () => {
    const calls: string[] = [];
    const iip: IIP = {
      id: "stub-iip",
      version: "0.0.1",
      appliesTo: "*",
      register(ctx) {
        ctx.registerUiSlot({ id: "slot-a" });
        calls.push(ctx.instrumentId);
      },
    };
    iip.register({
      instrumentId: "guitar",
      registerUiSlot: () => calls.push("slot"),
      registerAudioHook: () => {},
      registerSetting: () => {},
      getState: () => ({}),
      dispatch: () => {},
    });
    expect(calls).toEqual(["slot", "guitar"]);
  });
});
