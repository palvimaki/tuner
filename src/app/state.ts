import type { AnalysisFrame } from "../audio/frame-protocol";
import { absoluteLogDistance, centsFromHz } from "../audio/note-math";
import type { InstrumentString, TuningPreset } from "../domain/instrument";

export type TunerMode = "idle" | "probing" | "latched" | "locked" | "completed";
export const TUNE_LOCK_MS = 1_000;

export interface StringVisualState {
  cents: number | null;
  rawCents: number | null;
  pitchPenaltyCents: number;
  amplitude: number;
  lockedInThisSession: boolean;
  lockStartedMs: number | null;
  lockedAtMs: number | null;
  scoreDb: number;
}

export interface AppState {
  mode: TunerMode;
  presetId: string;
  activeStringId: string | null;
  probeStringId: string | null;
  probeLeadFrames: number;
  onsetLatchUntilMs: number;
  switchLeadFrames: number;
  lastGoodFrameAtMs: number;
  lastActivityAtMs: number;
  completedAtMs: number | null;
  strings: Record<string, StringVisualState>;
}

export interface FrameEffects {
  lockedStringId: string | null;
  completed: boolean;
}

export function createInitialState(preset: TuningPreset): AppState {
  return {
    mode: "idle",
    presetId: preset.id,
    activeStringId: null,
    probeStringId: null,
    probeLeadFrames: 0,
    onsetLatchUntilMs: 0,
    switchLeadFrames: 0,
    lastGoodFrameAtMs: 0,
    lastActivityAtMs: 0,
    completedAtMs: null,
    strings: Object.fromEntries(
      preset.strings.map((stringDef) => [
        stringDef.id,
        {
          cents: null,
          rawCents: null,
          pitchPenaltyCents: 0,
          amplitude: 0,
          lockedInThisSession: false,
          lockStartedMs: null,
          lockedAtMs: null,
          scoreDb: -120,
        },
      ]),
    ),
  };
}

function sameNoteClass(a: InstrumentString, b: InstrumentString): boolean {
  return a.id.slice(0, -1) === b.id.slice(0, -1);
}

function foldCentsToNearestOctave(cents: number): number {
  return ((((cents + 600) % 1200) + 1200) % 1200) - 600;
}

function octavePenaltyCents(rawCents: number): number {
  const octavesAway = Math.abs(Math.round(rawCents / 1200));
  if (octavesAway === 0) return 0;
  return 45 + (octavesAway - 1) * 25;
}

function tuningCentsFromHz(frequency: number, referenceHz: number): { rawCents: number; cents: number; penalty: number } {
  const candidates = [1, 2, 3, 4].map((harmonic) => {
    const rawCents = centsFromHz(frequency / harmonic, referenceHz);
    const cents = foldCentsToNearestOctave(rawCents);
    const harmonicPenalty = harmonic === 1 ? 0 : 30 + (harmonic - 2) * 18;
    const penalty = octavePenaltyCents(rawCents) + harmonicPenalty;
    return { rawCents: centsFromHz(frequency, referenceHz), cents, penalty };
  });

  return candidates.reduce((best, candidate) =>
    Math.abs(candidate.cents) + candidate.penalty < Math.abs(best.cents) + best.penalty
      ? candidate
      : best,
  );
}

export function nearestPresetStringByLogDistance(
  hz: number,
  preset: TuningPreset,
): InstrumentString {
  return preset.strings.reduce((best, candidate) =>
    absoluteLogDistance(hz, candidate.hz) < absoluteLogDistance(hz, best.hz) ? candidate : best,
  );
}

function frameAdmitted(frame: AnalysisFrame): boolean {
  return frame.rmsDb >= -55 && frame.clarity >= 0.82 && Object.keys(frame.profileScores).length > 0;
}

function smoothCents(previous: number | null, next: number | null): number | null {
  if (next === null) return null;
  if (previous === null || Math.abs(next - previous) > 150) return next;
  return previous + (next - previous) * 0.32;
}

function hydrateFrameIntoStrings(state: AppState, frame: AnalysisFrame, preset: TuningPreset): void {
  for (const stringDef of preset.strings) {
    const targetState = state.strings[stringDef.id];
    if (frame.hz > 0) {
      const tuningCents = tuningCentsFromHz(frame.hz, stringDef.hz);
      targetState.rawCents = tuningCents.rawCents;
      targetState.pitchPenaltyCents = tuningCents.penalty;
      targetState.cents = smoothCents(targetState.cents, tuningCents.cents);
    } else {
      targetState.rawCents = null;
      targetState.pitchPenaltyCents = 0;
      targetState.cents = smoothCents(targetState.cents, null);
    }
    targetState.amplitude = frame.amplitude;
    targetState.scoreDb = frame.profileScores[stringDef.id] ?? -120;
  }
}

function candidatePitchDistance(state: StringVisualState): number {
  const rawCents = state.rawCents;
  const cents = state.cents;
  if (rawCents === null || cents === null) return Infinity;
  return Math.abs(cents) + state.pitchPenaltyCents;
}

function likelyFrameString(
  state: AppState,
  preset: TuningPreset,
): { stringDef: InstrumentString; scoreDb: number; pitchDistance: number } | null {
  const candidates = preset.strings
    .map((stringDef) => {
      const stringState = state.strings[stringDef.id];
      return {
        stringDef,
        scoreDb: stringState.scoreDb,
        pitchDistance: candidatePitchDistance(stringState),
      };
    })
    .filter((candidate) => candidate.pitchDistance <= 120)
    .sort((a, b) => {
      const distanceDelta = a.pitchDistance - b.pitchDistance;
      if (!sameNoteClass(a.stringDef, b.stringDef) && Math.abs(distanceDelta) >= 12) {
        return distanceDelta;
      }
      if (Math.abs(distanceDelta) >= 30) return distanceDelta;
      return b.scoreDb - a.scoreDb;
    });

  return candidates[0] ?? null;
}

function bestChallenger(
  state: AppState,
  preset: TuningPreset,
): { stringDef: InstrumentString; marginDb: number; scoreDb: number; pitchDistance: number } | null {
  const active = preset.strings.find((stringDef) => stringDef.id === state.activeStringId);
  if (!active) return null;
  const candidates = preset.strings
    .filter((stringDef) => stringDef.id !== active.id)
    .map((stringDef) => ({
      stringDef,
      pitchDistance: candidatePitchDistance(state.strings[stringDef.id]),
      scoreDb: state.strings[stringDef.id].scoreDb,
      marginDb: sameNoteClass(stringDef, active) ? 6 : 3,
    }))
    .filter((candidate) => candidate.pitchDistance <= 120)
    .sort((a, b) => {
      const distanceDelta = a.pitchDistance - b.pitchDistance;
      if (!sameNoteClass(a.stringDef, b.stringDef) && Math.abs(distanceDelta) >= 12) {
        return distanceDelta;
      }
      if (Math.abs(distanceDelta) >= 30) return distanceDelta;
      return b.scoreDb - a.scoreDb;
    });

  return candidates[0] ?? null;
}

function everyStringLocked(state: AppState, preset: TuningPreset): boolean {
  return preset.strings.every((stringDef) => state.strings[stringDef.id].lockedInThisSession);
}

function resetProbe(state: AppState): void {
  state.probeStringId = null;
  state.probeLeadFrames = 0;
}

function latchString(state: AppState, stringId: string, nowMs: number, latchMs: number): void {
  state.activeStringId = stringId;
  state.onsetLatchUntilMs = nowMs + latchMs;
  state.switchLeadFrames = 0;
  resetProbe(state);
  state.mode = "latched";
}

export function resetForPreset(preset: TuningPreset): AppState {
  return createInitialState(preset);
}

export function applyAnalysisFrame(
  state: AppState,
  frame: AnalysisFrame,
  preset: TuningPreset,
  nowMs: number,
): FrameEffects {
  if (nowMs - state.lastActivityAtMs >= 90_000) {
    const fresh = createInitialState(preset);
    Object.assign(state, fresh);
  }

  hydrateFrameIntoStrings(state, frame, preset);

  if (!frameAdmitted(frame)) {
    if (state.activeStringId && nowMs - state.lastGoodFrameAtMs >= 2_500) {
      state.activeStringId = null;
      state.mode = "probing";
      state.switchLeadFrames = 0;
      resetProbe(state);
    }
    return { lockedStringId: null, completed: false };
  }

  state.lastGoodFrameAtMs = nowMs;
  state.lastActivityAtMs = nowMs;
  if (state.mode === "idle") state.mode = "probing";

  if (frame.onset && frame.hz > 0 && !state.activeStringId) {
    const nearest = nearestPresetStringByLogDistance(frame.hz, preset);
    latchString(state, nearest.id, nowMs, 100);
  } else if (frame.hz > 0 && !state.activeStringId) {
    const detected = likelyFrameString(state, preset);
    if (detected) {
      if (state.probeStringId === detected.stringDef.id) {
        state.probeLeadFrames += 1;
      } else {
        state.probeStringId = detected.stringDef.id;
        state.probeLeadFrames = 1;
      }
      if (state.probeLeadFrames >= 2) {
        latchString(state, detected.stringDef.id, nowMs, 80);
      }
    } else {
      resetProbe(state);
    }
  }

  if (state.activeStringId) {
    const activeState = state.strings[state.activeStringId];
    const activeDef = preset.strings.find((stringDef) => stringDef.id === state.activeStringId);
    const challenger = bestChallenger(state, preset);
    const activePitchDistance = candidatePitchDistance(activeState);

    if (
      challenger &&
      activeDef &&
      nowMs > state.onsetLatchUntilMs &&
      (challenger.pitchDistance + 24 <= activePitchDistance ||
        (activePitchDistance > 80 && challenger.scoreDb >= activeState.scoreDb + challenger.marginDb))
    ) {
      state.switchLeadFrames += 1;
      if (state.switchLeadFrames >= 4) {
        state.activeStringId = challenger.stringDef.id;
        state.switchLeadFrames = 0;
      }
    } else {
      state.switchLeadFrames = 0;
    }

    const currentId = state.activeStringId;
    const current = state.strings[currentId];
    const displayCentsAbs = Math.abs(current.cents ?? Infinity);
    const inTune = displayCentsAbs <= 7;
    if (inTune) {
      current.lockStartedMs ??= nowMs;
      if (!current.lockedInThisSession && nowMs - current.lockStartedMs >= TUNE_LOCK_MS) {
        current.lockedInThisSession = true;
        current.lockedAtMs = nowMs;
        state.mode = "locked";
        const completed = everyStringLocked(state, preset);
        if (completed && state.completedAtMs === null) {
          state.completedAtMs = nowMs;
          state.mode = "completed";
        }
        return { lockedStringId: currentId, completed };
      }
    } else {
      current.lockStartedMs = null;
      if (state.completedAtMs === null) {
        state.mode = "latched";
      }
    }
  }

  return { lockedStringId: null, completed: false };
}
