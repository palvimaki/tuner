export type OnsetMode = "transient" | "sustained";

export interface InstrumentString {
  id: string;
  midi: number;
  hz: number;
  // Optional, additive metadata. Existing consumers ignore these freely.
  targetHz?: number;
  displayLabel?: string;
  centOffset?: number;
  gaugeHint?: string;
}

export interface TuningPreset {
  id: string;
  name: string;
  strings: readonly InstrumentString[];
}

export interface AnalysisProfile {
  rangeHz: [number, number];
  onsetMode: OnsetMode;
}

export interface Instrument {
  id: string;
  family: "guitar" | "bass" | "ukulele" | "mandolin" | "violin";
  defaultPresetId: string;
  presets: readonly TuningPreset[];
  analysis: AnalysisProfile;
  iips?: readonly import("./iip").IIP[];
}

export function resolveStringTargetHz(stringDef: InstrumentString): number {
  const baseHz = stringDef.targetHz ?? stringDef.hz;
  const centOffset = stringDef.centOffset ?? 0;
  return baseHz * 2 ** (centOffset / 1200);
}
