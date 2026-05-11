import { noteNameToMidi } from "../../../audio/note-math";

const baseNotes = ["E2", "A2", "D3", "G3", "B3", "E4"] as const;

export interface ReferenceSampleMapping {
  baseId: string;
  url: string;
  detuneCents: number;
}

export function resolveReferenceSample(noteName: string): ReferenceSampleMapping {
  const targetMidi = noteNameToMidi(noteName);
  for (const baseId of baseNotes) {
    const baseMidi = noteNameToMidi(baseId);
    const semitoneDrop = baseMidi - targetMidi;
    if (semitoneDrop >= 0 && semitoneDrop <= 2) {
      return {
        baseId,
        url: `/audio/guitar/${baseId}.m4a`,
        detuneCents: -100 * semitoneDrop,
      };
    }
  }

  return {
    baseId: noteName,
    url: "",
    detuneCents: 0,
  };
}
