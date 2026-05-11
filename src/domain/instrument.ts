export type ExcitationMode = "plucked" | "bowed" | "blown";
export type OnsetMode = "transient" | "sustained";

export interface InstrumentString {
  id: string;
  midi: number;
  hz: number;
  sampleId: string;
}

export interface TuningPreset {
  id: string;
  name: string;
  strings: readonly InstrumentString[];
}

export interface AnalysisProfile {
  rangeHz: [number, number];
  excitation: ExcitationMode;
  onsetMode: OnsetMode;
}

export interface Instrument {
  id: string;
  family: "guitar" | "bass" | "ukulele" | "mandolin" | "violin";
  defaultPresetId: string;
  presets: readonly TuningPreset[];
  sampleMap: Record<string, string>;
  analysis: AnalysisProfile;
  iips?: readonly import("./iip").IIP[];
}
