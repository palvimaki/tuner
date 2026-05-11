export interface CelebrationState {
  startedAtMs: number | null;
}

export function createCelebrationState(): CelebrationState {
  return { startedAtMs: null };
}

export function triggerCelebration(state: CelebrationState, nowMs: number): void {
  state.startedAtMs = nowMs;
}
