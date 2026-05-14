import type { AppState } from "../app/state";
import { TUNE_LOCK_MS } from "../app/state";
import type { TuningPreset } from "../domain/instrument";

export interface RenderString {
  id: string;
  label: string;
  active: boolean;
  locked: boolean;
  inTune: boolean;
  lockProgress: number;
  donePulse: number;
  amplitude: number;
  cents: number | null;
}

export interface RenderState {
  mode: AppState["mode"];
  strings: RenderString[];
  pulsePicker: boolean;
  celebrationProgress: number;
}

export function computeStringXs(width: number, count: number): number[] {
  const padding = width * 0.16;
  const usable = width - padding * 2;
  return Array.from({ length: count }, (_, index) => padding + (usable * index) / (count - 1));
}

export function nearestStringIndexFromX(width: number, count: number, x: number): number {
  if (count <= 1) return 0;
  const xs = computeStringXs(width, count);
  const clampedX = Math.max(0, Math.min(width, x));
  return xs.reduce(
    (bestIndex, stringX, index) =>
      Math.abs(stringX - clampedX) < Math.abs(xs[bestIndex] - clampedX) ? index : bestIndex,
    0,
  );
}

export function buildRenderState(
  state: AppState,
  preset: TuningPreset,
  pulsePicker: boolean,
  nowMs: number,
): RenderState {
  const celebrationProgress =
    state.completedAtMs === null ? 0 : Math.max(0, Math.min(1, 1 - (nowMs - state.completedAtMs) / 1800));

  return {
    mode: state.mode,
    pulsePicker,
    celebrationProgress,
    strings: preset.strings.map((stringDef) => {
      const stringState = state.strings[stringDef.id];
      const inTune = stringState.lockStartedMs !== null || stringState.lockedInThisSession;
      const lockProgress =
        stringState.lockStartedMs === null
          ? 0
          : Math.max(0, Math.min(1, (nowMs - stringState.lockStartedMs) / TUNE_LOCK_MS));
      const donePulse =
        stringState.lockedAtMs === null
          ? 0
          : Math.max(0, Math.min(1, 1 - (nowMs - stringState.lockedAtMs) / 900));
      return {
        id: stringDef.id,
        label: stringDef.displayLabel ?? stringDef.id,
        active: state.activeStringId === stringDef.id,
        locked: stringState.lockedInThisSession,
        inTune,
        lockProgress,
        donePulse,
        amplitude: stringState.amplitude,
        cents: stringState.cents,
      };
    }),
  };
}
