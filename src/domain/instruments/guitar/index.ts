import type { Instrument } from "../../instrument";
import { guitarPresets } from "./presets";

export const guitarInstrument: Instrument = {
  id: "guitar-6",
  family: "guitar",
  defaultPresetId: "standard-e",
  analysis: {
    rangeHz: [60, 420],
    onsetMode: "transient",
  },
  presets: guitarPresets,
};
