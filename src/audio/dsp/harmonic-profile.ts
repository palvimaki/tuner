import type { InstrumentString, TuningPreset } from "../../domain/instrument";
import { goertzelMagnitude } from "./goertzel";
import { toDb } from "./smoothing";

function bandDb(signal: ArrayLike<number>, sampleRate: number, hz: number): number {
  const offsets = [-25, 0, 25];
  const sum = offsets.reduce((acc, cents) => {
    const shifted = hz * 2 ** (cents / 1200);
    return acc + goertzelMagnitude(signal, sampleRate, shifted);
  }, 0);
  return toDb(sum);
}

function lowerSameNoteFrequencies(stringDef: InstrumentString, preset: TuningPreset): number[] {
  return preset.strings
    .filter((candidate) => candidate.id !== stringDef.id)
    .filter((candidate) => candidate.id.slice(0, -1) === stringDef.id.slice(0, -1))
    .filter((candidate) => candidate.hz < stringDef.hz)
    .map((candidate) => candidate.hz);
}

export function scoreStringProfile(
  signal: ArrayLike<number>,
  sampleRate: number,
  stringDef: InstrumentString,
  preset: TuningPreset,
): number {
  const fundamental = bandDb(signal, sampleRate, stringDef.hz);
  const second = bandDb(signal, sampleRate, stringDef.hz * 2);
  const third = bandDb(signal, sampleRate, stringDef.hz * 3);
  const fourth = bandDb(signal, sampleRate, stringDef.hz * 4);
  const penalty = lowerSameNoteFrequencies(stringDef, preset)
    .map((hz) => bandDb(signal, sampleRate, hz))
    .reduce((max, value) => Math.max(max, value), -120);
  const missingFundamentalPenalty = Math.max(0, second - fundamental);
  const upperOctavePenalty = Math.max(0, fourth - second);

  return (
    fundamental +
    0.45 * second +
    0.2 * third +
    0.1 * fourth -
    0.55 * penalty -
    0.35 * missingFundamentalPenalty -
    0.2 * upperOctavePenalty
  );
}

export function scorePresetProfiles(
  signal: ArrayLike<number>,
  sampleRate: number,
  preset: TuningPreset,
): Record<string, number> {
  return Object.fromEntries(
    preset.strings.map((stringDef) => [
      stringDef.id,
      scoreStringProfile(signal, sampleRate, stringDef, preset),
    ]),
  );
}
