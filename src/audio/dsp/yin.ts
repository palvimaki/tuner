export interface YinResult {
  hz: number;
  confidence: number;
  tau: number;
  cmndAtTau: number;
}

export interface YinOptions {
  threshold?: number;
  minHz?: number;
  maxHz?: number;
}

const DEFAULT_THRESHOLD = 0.15;
const DEFAULT_MIN_HZ = 40;
const DEFAULT_MAX_HZ = 1400;

function parabolicTau(d: ArrayLike<number>, tau: number): number {
  const t = tau | 0;
  if (t <= 0 || t >= d.length - 1) return tau;
  const s0 = d[t - 1] ?? 0;
  const s1 = d[t] ?? 0;
  const s2 = d[t + 1] ?? 0;
  const denom = s0 + s2 - 2 * s1;
  if (denom === 0) return tau;
  const delta = (s0 - s2) / (2 * denom);
  return t + delta;
}

export function computeDifference(input: ArrayLike<number>, maxTau: number): Float32Array {
  const out = new Float32Array(maxTau);
  for (let tau = 1; tau < maxTau; tau += 1) {
    let sum = 0;
    for (let i = 0; i < maxTau; i += 1) {
      const delta = (input[i] ?? 0) - (input[i + tau] ?? 0);
      sum += delta * delta;
    }
    out[tau] = sum;
  }
  return out;
}

export function cumulativeMeanNormalized(diff: Float32Array): Float32Array {
  const out = new Float32Array(diff.length);
  out[0] = 1;
  let running = 0;
  for (let tau = 1; tau < diff.length; tau += 1) {
    running += diff[tau];
    out[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
  }
  return out;
}

export function findPitchYin(
  input: ArrayLike<number>,
  sampleRate: number,
  options: YinOptions = {},
): YinResult {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const minHz = options.minHz ?? DEFAULT_MIN_HZ;
  const maxHz = options.maxHz ?? DEFAULT_MAX_HZ;

  const maxTau = Math.min(input.length >> 1, Math.ceil(sampleRate / minHz) + 2);
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  if (maxTau <= minTau + 2) {
    return { hz: 0, confidence: 0, tau: 0, cmndAtTau: 1 };
  }

  const diff = computeDifference(input, maxTau);
  const cmnd = cumulativeMeanNormalized(diff);

  let tauEstimate = -1;
  for (let tau = minTau; tau < maxTau - 1; tau += 1) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < maxTau - 1 && cmnd[tau + 1] < cmnd[tau]) {
        tau += 1;
      }
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate === -1) {
    let bestTau = minTau;
    let bestVal = cmnd[minTau] ?? 1;
    for (let tau = minTau + 1; tau < maxTau - 1; tau += 1) {
      const v = cmnd[tau] ?? 1;
      if (v < bestVal) {
        bestVal = v;
        bestTau = tau;
      }
    }
    tauEstimate = bestTau;
  }

  const refined = parabolicTau(cmnd, tauEstimate);
  const cmndAtTau = cmnd[tauEstimate] ?? 1;
  const hz = refined > 0 ? sampleRate / refined : 0;
  const confidence = Math.max(0, Math.min(1, 1 - cmndAtTau));
  return { hz, confidence, tau: refined, cmndAtTau };
}

// Lightweight harmonic-energy assist: compares fundamental candidate energy with
// the candidate halved (octave-below) and doubled (octave-above) to detect octave
// errors without requiring an FFT dependency.
export function octaveSanityRatio(
  input: ArrayLike<number>,
  sampleRate: number,
  hz: number,
): { halfRatio: number; doubleRatio: number } {
  if (hz <= 0) return { halfRatio: 0, doubleRatio: 0 };
  const e0 = goertzelEnergy(input, sampleRate, hz);
  const eHalf = goertzelEnergy(input, sampleRate, hz / 2);
  const eDouble = goertzelEnergy(input, sampleRate, hz * 2);
  return {
    halfRatio: e0 > 0 ? eHalf / e0 : 0,
    doubleRatio: e0 > 0 ? eDouble / e0 : 0,
  };
}

function goertzelEnergy(signal: ArrayLike<number>, sampleRate: number, hz: number): number {
  if (hz <= 0 || hz >= sampleRate / 2) return 0;
  const omega = (2 * Math.PI * hz) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let q1 = 0;
  let q2 = 0;
  for (let i = 0; i < signal.length; i += 1) {
    const q0 = coeff * q1 - q2 + (signal[i] ?? 0);
    q2 = q1;
    q1 = q0;
  }
  return Math.max(0, q1 * q1 + q2 * q2 - coeff * q1 * q2);
}
