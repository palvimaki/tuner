import type { Instrument } from "../../instrument";

export const bass4Stub: Instrument = {
  id: "bass-4",
  family: "bass",
  defaultPresetId: "standard-e",
  sampleMap: {
    E1: "/audio/bass/E1.m4a",
    A1: "/audio/bass/A1.m4a",
    D2: "/audio/bass/D2.m4a",
    G2: "/audio/bass/G2.m4a",
  },
  analysis: {
    rangeHz: [40, 220],
    excitation: "plucked",
    onsetMode: "transient",
  },
  presets: [
    {
      id: "standard-e",
      name: "Standard E",
      strings: [
        { id: "E1", midi: 28, hz: 41.203, sampleId: "E1" },
        { id: "A1", midi: 33, hz: 55, sampleId: "A1" },
        { id: "D2", midi: 38, hz: 73.416, sampleId: "D2" },
        { id: "G2", midi: 43, hz: 97.999, sampleId: "G2" },
      ],
    },
  ],
};
