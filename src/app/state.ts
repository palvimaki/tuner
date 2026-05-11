import type { AnalysisFrame } from "../audio/frame-protocol";
import { absoluteLogDistance, centsFromHz } from "../audio/note-math";
import type { InstrumentString, TuningPreset } from "../domain/instrument";

export type TunerMode = "idle" | "probing" | "latched" | "locked" | "completed";

export interface StringVisualState {
  cents: number | null;
  amplitude: number;
  lockedInThisSession: boolean;
  lockStartedMs: number | null;
  scoreDb: number;
}

export interface AppState {
  mode: TunerMode;
  presetId: string;
  activeStringId: string | null;
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
          amplitude: 0,
          lockedInThisSession: false,
          lockStartedMs: null,
          scoreDb: -120,
        },
      ]),
    ),
  };
}

function sameNoteClass(a: InstrumentString, b: InstrumentString): boolean {
  return a.id.slice(0, -1) === b.id.slice(0, -1);
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

function hydrateFrameIntoStrings(state: AppState, frame: AnalysisFrame, preset: TuningPreset): void {
  for (const stringDef of preset.strings) {
    const cents = frame.hz > 0 ? centsFromHz(frame.hz, stringDef.hz) : null;
    const targetState = state.strings[stringDef.id];
    targetState.cents = cents;
    targetState.amplitude = frame.amplitude;
    targetState.scoreDb = frame.profileScores[stringDef.id] ?? -120;
  }
}

function bestChallenger(
  state: AppState,
  preset: TuningPreset,
): { stringDef: InstrumentString; marginDb: number; scoreDb: number } | null {
  const active = preset.strings.find((stringDef) => stringDef.id === state.activeStringId);
  if (!active) return null;
  const candidates = preset.strings
    .filter((stringDef) => stringDef.id !== active.id)
    .map((stringDef) => ({
      stringDef,
      centsAbs: Math.abs(state.strings[stringDef.id].cents ?? Infinity),
      scoreDb: state.strings[stringDef.id].scoreDb,
      marginDb: sameNoteClass(stringDef, active) ? 6 : 3,
    }))
    .filter((candidate) => candidate.centsAbs <= 70)
    .sort((a, b) => b.scoreDb - a.scoreDb);

  return candidates[0] ?? null;
}

function everyStringLocked(state: AppState, preset: TuningPreset): boolean {
  return preset.strings.every((stringDef) => state.strings[stringDef.id].lockedInThisSession);
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
  hydrateFrameIntoStrings(state, frame, preset);

  if (nowMs - state.lastActivityAtMs >= 90_000) {
    const fresh = createInitialState(preset);
    Object.assign(state, fresh);
  }

  if (!frameAdmitted(frame)) {
    if (state.activeStringId && nowMs - state.lastGoodFrameAtMs >= 2_500) {
      state.activeStringId = null;
      state.mode = "probing";
      state.switchLeadFrames = 0;
    }
    return { lockedStringId: null, completed: false };
  }

  state.lastGoodFrameAtMs = nowMs;
  state.lastActivityAtMs = nowMs;
  if (state.mode === "idle") state.mode = "probing";

  if (frame.onset && frame.hz > 0 && !state.activeStringId) {
    const nearest = nearestPresetStringByLogDistance(frame.hz, preset);
    state.activeStringId = nearest.id;
    state.onsetLatchUntilMs = nowMs + 100;
    state.switchLeadFrames = 0;
    state.mode = "latched";
  }

  if (state.activeStringId) {
    const activeState = state.strings[state.activeStringId];
    const activeDef = preset.strings.find((stringDef) => stringDef.id === state.activeStringId);
    const challenger = bestChallenger(state, preset);

    if (
      challenger &&
      activeDef &&
      nowMs > state.onsetLatchUntilMs &&
      challenger.scoreDb >= activeState.scoreDb + challenger.marginDb
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
    if (Math.abs(current.cents ?? Infinity) <= 5 && current.scoreDb > -70) {
      current.lockStartedMs ??= nowMs;
      if (!current.lockedInThisSession && nowMs - current.lockStartedMs >= 1_500) {
        current.lockedInThisSession = true;
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
      state.mode = "latched";
    }
  }

  return { lockedStringId: null, completed: false };
}
