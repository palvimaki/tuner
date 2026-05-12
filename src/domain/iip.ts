// IIP — Instrument Integration Protocol
// Contract-only surface. No heavy ML implementation lives here; this file
// declares typed interfaces so future pitch engines, string classifiers, and
// model manifests can be plugged in behind a stable boundary.

export interface UiSlotRegistration {
  id: string;
}

export interface AudioHook {
  id: string;
}

export interface SettingRegistration {
  id: string;
}

export interface IIPContext {
  instrumentId: string;
  registerUiSlot(slot: UiSlotRegistration): void;
  registerAudioHook(hook: AudioHook): void;
  registerSetting(setting: SettingRegistration): void;
  getState(): unknown;
  dispatch(action: unknown): void;
}

export interface IIP {
  id: string;
  version: string;
  appliesTo: "*" | readonly string[];
  register(ctx: IIPContext): void;
}

// ---------------------------------------------------------------------------
// Pitch engines
// ---------------------------------------------------------------------------

export type PitchEngineKind = "mpm" | "yin" | "goertzel" | "hybrid" | "ml";

export interface PitchEstimate {
  hz: number;
  confidence: number; // 0..1
  timestamp: number; // seconds since audio context start
  // Optional periodicity / clarity score reported by the engine itself.
  clarity?: number;
}

export interface PitchEngineConfig {
  sampleRate: number;
  // Engine-specific options pass through opaquely.
  options?: Readonly<Record<string, unknown>>;
}

export interface PitchEngine {
  id: string;
  kind: PitchEngineKind;
  version: string;
  init(config: PitchEngineConfig): Promise<void> | void;
  process(frame: Float32Array): PitchEstimate | null;
  dispose?(): void;
}

// ---------------------------------------------------------------------------
// String classifiers
// ---------------------------------------------------------------------------

export interface StringClassificationInput {
  pitchHz: number;
  features?: Readonly<Record<string, number>>;
}

export interface StringClassification {
  stringId: string;
  confidence: number; // 0..1
}

export interface StringClassifier {
  id: string;
  version: string;
  classify(
    input: StringClassificationInput,
    candidates: readonly string[],
  ): StringClassification | null;
}

// ---------------------------------------------------------------------------
// Model manifests (for future on-device ML assets)
// ---------------------------------------------------------------------------

export type ModelKind = "pitch" | "string-classifier" | "multi-f0" | "embedding";
export type ModelRuntime = "tfjs" | "onnx" | "onnx-webgpu" | "webnn" | "wasm" | "native";

export interface ModelManifest {
  id: string;
  kind: ModelKind;
  version: string;
  runtime: ModelRuntime;
  // Relative or remote path; loader resolves it.
  assetUrl: string;
  sha256?: string;
  sizeBytes?: number;
  inputSampleRate?: number;
  // Free-form capability flags (e.g. { polyphonic: true, maxVoices: 6 }).
  capabilities?: Readonly<Record<string, boolean | number | string>>;
}

// ---------------------------------------------------------------------------
// Polyphonic / multi-F0 analyzers (future)
// ---------------------------------------------------------------------------

export interface MultiF0Estimate {
  voices: readonly PitchEstimate[];
  timestamp: number;
}

export interface PolyphonicAnalyzer {
  id: string;
  version: string;
  maxVoices: number;
  init(config: PitchEngineConfig): Promise<void> | void;
  process(frame: Float32Array): MultiF0Estimate | null;
  dispose?(): void;
}

// ---------------------------------------------------------------------------
// Capability checks for browser / local runtimes
// ---------------------------------------------------------------------------

export interface RuntimeCapabilities {
  audioWorklet: boolean;
  sharedArrayBuffer: boolean;
  wasm: boolean;
  webgpu: boolean;
  webnn: boolean;
  offlineAudioContext: boolean;
}

export interface CapabilityCheck {
  id: string;
  describe(): string;
  check(env?: Partial<RuntimeCapabilities>): boolean;
}

export function detectRuntimeCapabilities(
  globalRef: unknown = typeof globalThis !== "undefined" ? globalThis : undefined,
): RuntimeCapabilities {
  const g = (globalRef ?? {}) as Record<string, unknown>;
  const navigatorRef = (g["navigator"] ?? {}) as Record<string, unknown>;
  return {
    audioWorklet: typeof g["AudioWorkletNode"] === "function",
    sharedArrayBuffer: typeof g["SharedArrayBuffer"] === "function",
    wasm: typeof g["WebAssembly"] === "object" && g["WebAssembly"] !== null,
    webgpu: typeof navigatorRef["gpu"] === "object" && navigatorRef["gpu"] !== null,
    webnn:
      typeof navigatorRef["ml"] === "object" ||
      typeof g["MLContext"] === "function" ||
      typeof g["MLGraphBuilder"] === "function",
    offlineAudioContext: typeof g["OfflineAudioContext"] === "function",
  };
}
