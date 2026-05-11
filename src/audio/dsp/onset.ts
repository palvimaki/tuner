export interface OnsetConfig {
  floorDb: number;
  marginDb: number;
  debounceMs: number;
}

export interface OnsetState {
  slowRmsDb: number;
  lastOnsetMs: number;
}

export function detectOnset(
  state: OnsetState,
  shortRmsDb: number,
  nowMs: number,
  config: OnsetConfig,
): { next: OnsetState; onset: boolean } {
  const onset =
    shortRmsDb >= config.floorDb &&
    shortRmsDb - state.slowRmsDb >= config.marginDb &&
    nowMs - state.lastOnsetMs >= config.debounceMs;

  return {
    onset,
    next: {
      slowRmsDb: state.slowRmsDb,
      lastOnsetMs: onset ? nowMs : state.lastOnsetMs,
    },
  };
}
