export interface PitchResult {
  hz: number;
  clarity: number;
}

function computeNsdf(input: ArrayLike<number>): Float32Array {
  const outLength = Math.floor(input.length / 2);
  const out = new Float32Array(outLength);

  for (let tau = 0; tau < outLength; tau += 1) {
    let acf = 0;
    let divisor = 0;
    for (let i = 0; i < outLength; i += 1) {
      const x = input[i] ?? 0;
      const y = input[i + tau] ?? 0;
      acf += x * y;
      divisor += x * x + y * y;
    }
    out[tau] = divisor > 0 ? (2 * acf) / divisor : 0;
  }

  return out;
}

function parabolicPeak(buffer: ArrayLike<number>, index: number): number {
  const left = buffer[index - 1] ?? buffer[index] ?? 0;
  const center = buffer[index] ?? 0;
  const right = buffer[index + 1] ?? center;
  const denominator = left - 2 * center + right;
  if (denominator === 0) return index;
  return index + (left - right) / (2 * denominator);
}

function pickPeak(nsdf: ArrayLike<number>): number {
  let bestIndex = -1;
  let bestValue = 0;
  let seenPositive = false;

  for (let i = 1; i < nsdf.length - 1; i += 1) {
    const value = nsdf[i] ?? 0;
    if (value > 0) seenPositive = true;
    if (
      seenPositive &&
      value > bestValue &&
      value > (nsdf[i - 1] ?? value) &&
      value >= (nsdf[i + 1] ?? value)
    ) {
      bestIndex = i;
      bestValue = value;
    }
  }

  return bestIndex;
}

export function findPitchMpm(input: ArrayLike<number>, sampleRate: number): PitchResult {
  const nsdf = computeNsdf(input);
  const peakIndex = pickPeak(nsdf);
  if (peakIndex <= 0) return { hz: 0, clarity: 0 };
  const refined = parabolicPeak(nsdf, peakIndex);
  const period = refined > 0 ? refined : peakIndex;
  return {
    hz: period > 0 ? sampleRate / period : 0,
    clarity: Math.max(0, Math.min(1, nsdf[peakIndex] ?? 0)),
  };
}
