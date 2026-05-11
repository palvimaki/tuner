import type { Instrument } from "../../instrument";
import { guitarPresets } from "./presets";

export const guitarInstrument: Instrument = {
  id: "guitar-6",
  family: "guitar",
  defaultPresetId: "standard-e",
  sampleMap: {
    E2: "/audio/guitar/E2.m4a",
    A2: "/audio/guitar/A2.m4a",
    D3: "/audio/guitar/D3.m4a",
    G3: "/audio/guitar/G3.m4a",
    B3: "/audio/guitar/B3.m4a",
    E4: "/audio/guitar/E4.m4a",
  },
  analysis: {
    rangeHz: [60, 420],
    excitation: "plucked",
    onsetMode: "transient",
  },
  presets: guitarPresets,
};
