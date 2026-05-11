const NOTE_ORDER = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;
const NOTE_TO_INDEX: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

export function noteNameToMidi(note: string): number {
  const match = /^([A-G](?:#|b)?)(-?\d+)$/.exec(note);
  if (!match) throw new Error(`Invalid note: ${note}`);
  const [, name, octaveRaw] = match;
  const octave = Number(octaveRaw);
  const semitone = NOTE_TO_INDEX[name];
  if (semitone === undefined) throw new Error(`Invalid note name: ${note}`);
  return (octave + 1) * 12 + semitone;
}

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  const index = ((rounded % 12) + 12) % 12;
  return `${NOTE_ORDER[index]}${octave}`;
}

export function hzFromMidi(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function centsBetween(frequency: number, referenceHz: number): number {
  return 1200 * Math.log2(frequency / referenceHz);
}

export function centsFromHz(frequency: number, referenceHz: number): number {
  return centsBetween(frequency, referenceHz);
}

export function absoluteLogDistance(hzA: number, hzB: number): number {
  return Math.abs(Math.log2(hzA / hzB));
}
