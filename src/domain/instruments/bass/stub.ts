import type { Instrument } from "../../instrument";

export const bass4Stub: Instrument = {
  id: "bass-4",
  family: "bass",
  defaultPresetId: "standard-e",
  analysis: {
    rangeHz: [40, 220],
    onsetMode: "transient",
  },
  presets: [
    {
      id: "standard-e",
      name: "Standard E",
      strings: [
        { id: "E1", midi: 28, hz: 41.203 },
        { id: "A1", midi: 33, hz: 55 },
        { id: "D2", midi: 38, hz: 73.416 },
        { id: "G2", midi: 43, hz: 97.999 },
      ],
    },
  ],
};
