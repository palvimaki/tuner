import type { AppState } from "../app/state";
import type { TuningPreset } from "../domain/instrument";

export interface RenderString {
  id: string;
  label: string;
  active: boolean;
  locked: boolean;
  amplitude: number;
  cents: number | null;
}

export interface RenderState {
  mode: AppState["mode"];
  strings: RenderString[];
  dimmed: boolean;
  pulsePicker: boolean;
  celebrationProgress: number;
}

export function computeStringXs(width: number, count: number): number[] {
  const padding = width * 0.16;
  const usable = width - padding * 2;
  return Array.from({ length: count }, (_, index) => padding + (usable * index) / (count - 1));
}

function displayLabel(noteId: string): string {
  const match = noteId.match(/[A-G]/i);
  return match ? match[0].toUpperCase() : noteId.slice(0, 1).toUpperCase();
}

export function buildRenderState(
  state: AppState,
  preset: TuningPreset,
  dimmed: boolean,
  pulsePicker: boolean,
  nowMs: number,
): RenderState {
  const celebrationProgress =
    state.completedAtMs === null ? 0 : Math.max(0, Math.min(1, 1 - (nowMs - state.completedAtMs) / 1800));

  return {
    mode: state.mode,
    dimmed,
    pulsePicker,
    celebrationProgress,
    strings: preset.strings.map((stringDef) => {
      const stringState = state.strings[stringDef.id];
      return {
        id: stringDef.id,
        label: displayLabel(stringDef.id),
        active: state.activeStringId === stringDef.id,
        locked: stringState.lockedInThisSession,
        amplitude: stringState.amplitude,
        cents: stringState.cents,
      };
    }),
  };
}
