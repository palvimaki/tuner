export const TRANSIENT_SUPPRESS_MS = 120;
export const STABLE_TAIL_CENTS = 25;
export const STABLE_TAIL_FRAMES = 3;
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export function isTransientSuppressed(nowMs: number, lastOnsetMs: number): boolean {
  return nowMs - lastOnsetMs < TRANSIENT_SUPPRESS_MS;
}

export function isLowConfidence(confidence: number, transientSuppressed: boolean): boolean {
  return confidence < LOW_CONFIDENCE_THRESHOLD || transientSuppressed;
}

export function isStableTail(history: ArrayLike<number>): boolean {
  if (history.length < STABLE_TAIL_FRAMES) return false;
  const ref = history[history.length - 1];
  if (!ref || ref <= 0) return false;
  for (let i = history.length - STABLE_TAIL_FRAMES; i < history.length; i += 1) {
    const value = history[i];
    if (!value || value <= 0) return false;
    const cents = 1200 * Math.log2(value / ref);
    if (Math.abs(cents) > STABLE_TAIL_CENTS) return false;
  }
  return true;
}
