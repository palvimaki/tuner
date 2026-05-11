export function goertzelMagnitude(
  signal: ArrayLike<number>,
  sampleRate: number,
  targetHz: number,
): number {
  const omega = (2 * Math.PI * targetHz) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;

  for (let i = 0; i < signal.length; i += 1) {
    q0 = coeff * q1 - q2 + (signal[i] ?? 0);
    q2 = q1;
    q1 = q0;
  }

  return Math.sqrt(q1 * q1 + q2 * q2 - coeff * q1 * q2);
}
