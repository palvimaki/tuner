import type { InstrumentString, TuningPreset } from "../../instrument";
import { hzFromMidi, noteNameToMidi } from "../../../audio/note-math";

// Plain ASCII label used by the UI ("E2", "Eb2", "F#3"…).
function asciiLabel(note: string): string {
  return note;
}

// Suggested string gauges for standard-E acoustic/electric tuning (mil).
// Keyed by string id so alternate tunings can reuse them where they overlap.
const GAUGE_HINT_BY_ID: Readonly<Record<string, string>> = {
  E2: ".046",
  A2: ".036",
  D3: ".026",
  G3: ".017",
  B3: ".013",
  E4: ".010",
};

function buildPreset(id: string, name: string, notes: readonly string[]): TuningPreset {
  return {
    id,
    name,
    strings: notes.map((note): InstrumentString => {
      const midi = noteNameToMidi(note);
      const hz = hzFromMidi(midi);
      return {
        id: note,
        midi,
        hz,
        targetHz: hz,
        displayLabel: asciiLabel(note),
        centOffset: 0,
        gaugeHint: GAUGE_HINT_BY_ID[note],
      };
    }),
  };
}

export const guitarPresets: readonly TuningPreset[] = [
  buildPreset("standard-e", "Standard E", ["E2", "A2", "D3", "G3", "B3", "E4"]),
  buildPreset("drop-d", "Drop D", ["D2", "A2", "D3", "G3", "B3", "E4"]),
  buildPreset("half-step-down", "Half Step Down", ["Eb2", "Ab2", "Db3", "Gb3", "Bb3", "Eb4"]),
  buildPreset("full-step-down", "Full Step Down", ["D2", "G2", "C3", "F3", "A3", "D4"]),
  buildPreset("dadgad", "DADGAD", ["D2", "A2", "D3", "G3", "A3", "D4"]),
  buildPreset("open-g", "Open G", ["D2", "G2", "D3", "G3", "B3", "D4"]),
  buildPreset("open-d", "Open D", ["D2", "A2", "D3", "F#3", "A3", "D4"]),
];
