export interface PitchResult {
  hz: number;
  clarity: number;
}

const MPM_CLARITY_THRESHOLD = 0.9;

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

function parabolicPeak(
  buffer: ArrayLike<number>,
  index: number,
): { index: number; value: number } {
  const left = buffer[index - 1] ?? buffer[index] ?? 0;
  const center = buffer[index] ?? 0;
  const right = buffer[index + 1] ?? center;
  const a = left / 2 - center + right / 2;
  if (a === 0) {
    return { index, value: center };
  }
  const b = -(left / 2) * (2 * index + 1) + center * (2 * index) - (right / 2) * (2 * index - 1);
  const c =
    (left * index * (index + 1)) / 2 -
    center * (index - 1) * (index + 1) +
    (right * index * (index - 1)) / 2;
  const refinedIndex = -b / (2 * a);
  return {
    index: refinedIndex,
    value: a * refinedIndex * refinedIndex + b * refinedIndex + c,
  };
}

function collectKeyMaximumIndices(nsdf: ArrayLike<number>): number[] {
  const keyIndices: number[] = [];
  let lookingForMaximum = false;
  let maxIndex = -1;
  let maxValue = -Infinity;

  for (let i = 1; i < nsdf.length - 1; i += 1) {
    const previous = nsdf[i - 1] ?? 0;
    const value = nsdf[i] ?? 0;
    if (previous <= 0 && value > 0) {
      lookingForMaximum = true;
      maxIndex = i;
      maxValue = value;
    } else if (previous > 0 && value <= 0) {
      lookingForMaximum = false;
      if (maxIndex !== -1) {
        keyIndices.push(maxIndex);
      }
    } else if (lookingForMaximum && value > maxValue) {
      maxValue = value;
      maxIndex = i;
    }
  }

  return keyIndices;
}

export function pickPeak(nsdf: ArrayLike<number>, clarityThreshold = MPM_CLARITY_THRESHOLD): number {
  const keyMaximumIndices = collectKeyMaximumIndices(nsdf);
  if (keyMaximumIndices.length === 0) return -1;

  const maxKeyMaximum = keyMaximumIndices.reduce((best, index) => {
    return Math.max(best, nsdf[index] ?? 0);
  }, -Infinity);
  const threshold = maxKeyMaximum * clarityThreshold;
  return keyMaximumIndices.find((index) => (nsdf[index] ?? 0) >= threshold) ?? -1;
}

export function findPitchMpm(input: ArrayLike<number>, sampleRate: number): PitchResult {
  const nsdf = computeNsdf(input);
  const peakIndex = pickPeak(nsdf);
  if (peakIndex <= 0) return { hz: 0, clarity: 0 };
  const refined = parabolicPeak(nsdf, peakIndex);
  const period = refined.index > 0 ? refined.index : peakIndex;
  return {
    hz: period > 0 ? sampleRate / period : 0,
    clarity: Math.max(0, Math.min(1, refined.value)),
  };
}
