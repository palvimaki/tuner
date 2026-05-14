import type { InstrumentString, TuningPreset } from "../../domain/instrument";
import { goertzelMagnitude } from "./goertzel";
import { toDb } from "./smoothing";

function bandMagnitude(signal: ArrayLike<number>, sampleRate: number, hz: number): number {
  const offsets = [-25, 0, 25];
  return offsets.reduce((acc, cents) => {
    const shifted = hz * 2 ** (cents / 1200);
    return acc + goertzelMagnitude(signal, sampleRate, shifted);
  }, 0);
}

function bandDb(signal: ArrayLike<number>, sampleRate: number, hz: number): number {
  return toDb(bandMagnitude(signal, sampleRate, hz));
}

function lowerSameNoteFrequencies(stringDef: InstrumentString, preset: TuningPreset): number[] {
  return preset.strings
    .filter((candidate) => candidate.id !== stringDef.id)
    .filter((candidate) => candidate.id.slice(0, -1) === stringDef.id.slice(0, -1))
    .filter((candidate) => candidate.hz < stringDef.hz)
    .map((candidate) => candidate.hz);
}

function lowerSameNotePenaltyDb(
  signal: ArrayLike<number>,
  sampleRate: number,
  stringDef: InstrumentString,
  preset: TuningPreset,
): number {
  const lowerFrequencies = lowerSameNoteFrequencies(stringDef, preset);
  if (lowerFrequencies.length === 0) return -120;
  return lowerFrequencies
    .map((hz) => bandDb(signal, sampleRate, hz))
    .reduce((max, value) => Math.max(max, value), -120);
}

function upperSameNotePenaltyDb(
  signal: ArrayLike<number>,
  sampleRate: number,
  stringDef: InstrumentString,
  preset: TuningPreset,
): number {
  const upperFrequencies = preset.strings
    .filter((candidate) => candidate.id !== stringDef.id)
    .filter((candidate) => candidate.id.slice(0, -1) === stringDef.id.slice(0, -1))
    .filter((candidate) => candidate.hz > stringDef.hz)
    .map((candidate) => candidate.hz);
  if (upperFrequencies.length === 0) return -120;
  return upperFrequencies
    .map((hz) => bandDb(signal, sampleRate, hz))
    .reduce((max, value) => Math.max(max, value), -120);
}

export function scoreStringProfile(
  signal: ArrayLike<number>,
  sampleRate: number,
  stringDef: InstrumentString,
  preset: TuningPreset,
): number {
  const fundamentalMag = bandMagnitude(signal, sampleRate, stringDef.hz);
  const secondMag = bandMagnitude(signal, sampleRate, stringDef.hz * 2);
  const thirdMag = bandMagnitude(signal, sampleRate, stringDef.hz * 3);
  const fourthMag = bandMagnitude(signal, sampleRate, stringDef.hz * 4);
  const fundamental = toDb(fundamentalMag);
  const second = toDb(secondMag);
  const fourth = toDb(fourthMag);
  const lowerSameNoteDb = lowerSameNotePenaltyDb(signal, sampleRate, stringDef, preset);
  const upperPenalty = upperSameNotePenaltyDb(signal, sampleRate, stringDef, preset);
  const missingFundamentalPenalty = Math.max(0, second - fundamental);
  const upperOctavePenalty = Math.max(0, fourth - second);
  const lowerSameNotePenalty = Math.max(0, lowerSameNoteDb - fundamental);
  const directUpperSameNotePenalty = Math.max(0, upperPenalty - Math.max(fundamental, second));
  const lowString = stringDef.hz < 100;
  const harmonicTotal =
    (lowString ? 0.65 : 1) * fundamentalMag +
    (lowString ? 0.6 : 0.45) * secondMag +
    (lowString ? 0.38 : 0.2) * thirdMag +
    (lowString ? 0.18 : 0.1) * fourthMag;

  return (
    toDb(harmonicTotal) -
    0.55 * lowerSameNotePenalty -
    0.7 * directUpperSameNotePenalty -
    (lowString ? 0.12 : 0.28) * missingFundamentalPenalty -
    (lowString ? 0.2 : 0.55) * upperOctavePenalty
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
