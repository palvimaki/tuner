export function rms(signal: ArrayLike<number>): number {
  if (signal.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < signal.length; i += 1) {
    const value = signal[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / signal.length);
}

export function toDb(value: number, floor = 1e-9): number {
  return 20 * Math.log10(Math.max(value, floor));
}

export function ema(previous: number, next: number, alpha: number): number {
  return previous + alpha * (next - previous);
}
