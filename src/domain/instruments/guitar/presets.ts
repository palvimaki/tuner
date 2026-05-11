import type { TuningPreset } from "../../instrument";
import { hzFromMidi, noteNameToMidi } from "../../../audio/note-math";

function buildPreset(id: string, name: string, notes: readonly string[]): TuningPreset {
  return {
    id,
    name,
    strings: notes.map((note) => {
      const midi = noteNameToMidi(note);
      return {
        id: note,
        midi,
        hz: hzFromMidi(midi),
        sampleId: note,
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
