/*!
 * tuner-processor — YIN/CMNDF F0 estimation with optional MPM fallback debug
 * candidate. The YIN algorithm is in the public domain
 * (de Cheveigné & Kawahara, 2002). The MPM helper section is adapted from
 * pitchy 4.1.0 (https://github.com/ianprime0509/pitchy), © Ian Johnson,
 * ISC License — permission to use, copy, modify, and/or distribute granted.
 */

const YIN_THRESHOLD = 0.15;
const YIN_MIN_HZ = 55;
const YIN_MAX_HZ = 1400;
const HIGH_PASS_POLE = 0.996;
const TRANSIENT_SUPPRESS_MS = 60;
const STABLE_TAIL_CENTS = 12;
const STABLE_TAIL_FRAMES = 3;
const TARGET_SEARCH_CENTS = 140;
const TARGET_MAX_CMNDF = 0.45;
const RAW_RELATION_MAX_CENTS = 45;
const MAX_HARMONIC_RELATION = 4;
const PROFILE_FLOOR_DB = -180;
const ONSET_FLOOR_DB = -58;
const ONSET_RMS_WINDOW = 512;

function toDb(value) {
  return 20 * Math.log10(Math.max(value, 1e-9));
}

function goertzelMagnitude(signal, sampleRate, targetHz) {
  const omega = (2 * Math.PI * targetHz) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  for (let i = 0; i < signal.length; i += 1) {
    q0 = coeff * q1 - q2 + signal[i];
    q2 = q1;
    q1 = q0;
  }
  return Math.sqrt(Math.max(0, q1 * q1 + q2 * q2 - coeff * q1 * q2));
}

function bandMagnitude(signal, sampleRate, hz) {
  const cents = [-25, 0, 25];
  let total = 0;
  for (const cent of cents) {
    total += goertzelMagnitude(signal, sampleRate, hz * 2 ** (cent / 1200));
  }
  return total;
}

function bandDb(signal, sampleRate, hz) {
  return toDb(bandMagnitude(signal, sampleRate, hz));
}

function centsBetween(hz, referenceHz) {
  return 1200 * Math.log2(hz / referenceHz);
}

// ---- YIN (FFT-accelerated full-window difference) ----
const fftPlans = new Map();

function getFftPlan(size) {
  let plan = fftPlans.get(size);
  if (plan) return plan;

  const half = size >> 1;
  const bits = Math.round(Math.log2(size));
  const bitrev = new Uint32Array(size);
  for (let i = 0; i < size; i += 1) {
    let x = i;
    let rev = 0;
    for (let b = 0; b < bits; b += 1) {
      rev = (rev << 1) | (x & 1);
      x >>= 1;
    }
    bitrev[i] = rev;
  }

  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let i = 0; i < half; i += 1) {
    const angle = (-2 * Math.PI * i) / size;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }

  plan = {
    size,
    bitrev,
    cos,
    sin,
    re: new Float64Array(size),
    im: new Float64Array(size),
    prefixSq: new Float64Array(size + 1),
  };
  fftPlans.set(size, plan);
  return plan;
}

function fftInPlace(re, im, plan) {
  const n = plan.size;
  const bitrev = plan.bitrev;
  const cos = plan.cos;
  const sin = plan.sin;

  for (let i = 0; i < n; i += 1) {
    const j = bitrev[i];
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      let tableIdx = 0;
      for (let j = 0; j < halfLen; j += 1) {
        const idx1 = i + j;
        const idx2 = idx1 + halfLen;
        const wr = cos[tableIdx];
        const wi = sin[tableIdx];
        const xr = re[idx2];
        const xi = im[idx2];
        const tRe = wr * xr - wi * xi;
        const tIm = wr * xi + wi * xr;
        re[idx2] = re[idx1] - tRe;
        im[idx2] = im[idx1] - tIm;
        re[idx1] += tRe;
        im[idx1] += tIm;
        tableIdx += step;
      }
    }
  }
}

function yinDifference(input, maxTau) {
  const out = new Float32Array(maxTau);
  const n = input.length;
  const windowLength = Math.max(1, n - maxTau);
  let fftSize = 1;
  while (fftSize < n) fftSize <<= 1;

  const plan = getFftPlan(fftSize);
  const re = plan.re;
  const im = plan.im;
  const prefixSq = plan.prefixSq;

  re.fill(0);
  im.fill(0);
  prefixSq[0] = 0;
  for (let i = 0; i < n; i += 1) {
    const v = input[i];
    if (i < windowLength) re[i] = v;
    im[i] = v;
    prefixSq[i + 1] = prefixSq[i] + v * v;
  }

  fftInPlace(re, im, plan);

  const half = fftSize >> 1;
  const a0 = re[0];
  const b0 = im[0];
  re[0] = a0 * b0;
  im[0] = 0;
  if (half > 0) {
    const ah = re[half];
    const bh = im[half];
    re[half] = ah * bh;
    im[half] = 0;
  }

  for (let k = 1; k < half; k += 1) {
    const j = fftSize - k;
    const rk = re[k];
    const rj = re[j];
    const ik = im[k];
    const ij = im[j];
    const ar = 0.5 * (rk + rj);
    const ai = 0.5 * (ik - ij);
    const br = 0.5 * (ik + ij);
    const bi = 0.5 * (rj - rk);
    // conj(conj(A) * B) so forward FFT yields M * sum_i a[i] * b[i + tau]
    const pr = ar * br + ai * bi;
    const pi = ai * br - ar * bi;
    re[k] = pr;
    im[k] = pi;
    re[j] = pr;
    im[j] = -pi;
  }

  fftInPlace(re, im, plan);

  const e0 = prefixSq[windowLength];
  const invSize = 1 / fftSize;
  for (let tau = 1; tau < maxTau; tau += 1) {
    const eTau = prefixSq[tau + windowLength] - prefixSq[tau];
    const corr = re[tau] * invSize;
    const val = e0 + eTau - 2 * corr;
    out[tau] = val > 0 ? val : 0;
  }
  return out;
}

function yinCmnd(diff) {
  const out = new Float32Array(diff.length);
  out[0] = 1;
  let running = 0;
  for (let tau = 1; tau < diff.length; tau += 1) {
    running += diff[tau];
    out[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
  }
  return out;
}

function parabolicTau(d, tau) {
  if (tau <= 0 || tau >= d.length - 1) return tau;
  const s0 = d[tau - 1];
  const s1 = d[tau];
  const s2 = d[tau + 1];
  const denom = s0 + s2 - 2 * s1;
  if (denom === 0) return tau;
  return tau + (s0 - s2) / (2 * denom);
}

function findPitchYIN(input, sampleRate, minHz, maxHz) {
  const safeMinHz = minHz > 0 ? minHz : YIN_MIN_HZ;
  const safeMaxHz = maxHz > 0 ? maxHz : YIN_MAX_HZ;
  const maxTau = Math.min(input.length >> 1, Math.ceil(sampleRate / safeMinHz) + 2);
  const minTau = Math.max(2, Math.floor(sampleRate / safeMaxHz));
  if (maxTau <= minTau + 2) return { hz: 0, confidence: 0, cmndAtTau: 1 };

  const diff = yinDifference(input, maxTau);
  const cmnd = yinCmnd(diff);

  let tauEst = -1;
  for (let tau = minTau; tau < maxTau - 1; tau += 1) {
    if (cmnd[tau] < YIN_THRESHOLD) {
      while (tau + 1 < maxTau - 1 && cmnd[tau + 1] < cmnd[tau]) tau += 1;
      tauEst = tau;
      break;
    }
  }
  if (tauEst === -1) {
    let bestTau = minTau;
    let bestVal = cmnd[minTau];
    for (let tau = minTau + 1; tau < maxTau - 1; tau += 1) {
      if (cmnd[tau] < bestVal) {
        bestVal = cmnd[tau];
        bestTau = tau;
      }
    }
    tauEst = bestTau;
  } else if (cmnd[tauEst] > 0.015) {
    const origTau = tauEst;
    const origVal = cmnd[origTau];
    let bestSubVal = origVal;
    for (const mult of [2, 3]) {
      const center = Math.round(origTau * mult);
      if (center < minTau || center >= maxTau - 2) continue;
      const lo = Math.max(minTau, center - 3);
      const hi = Math.min(maxTau - 2, center + 3);
      let localTau = lo;
      let localVal = cmnd[lo];
      for (let t = lo + 1; t <= hi; t += 1) {
        if (cmnd[t] < localVal) {
          localVal = cmnd[t];
          localTau = t;
        }
      }
      if (localVal < origVal * 0.4 && localVal < 0.08 && localVal < bestSubVal) {
        bestSubVal = localVal;
        tauEst = localTau;
      }
    }
  }

  const cmndAtTau = cmnd[tauEst];
  const refined = parabolicTau(cmnd, tauEst);
  const hz = refined > 0 ? sampleRate / refined : 0;
  const confidence = Math.max(0, Math.min(1, 1 - cmndAtTau));
  return { hz, confidence, cmndAtTau, cmnd };
}

function localTargetPitch(cmnd, sampleRate, targetHz) {
  const centerTau = sampleRate / targetHz;
  const minTau = Math.max(2, Math.floor(centerTau * 2 ** (-TARGET_SEARCH_CENTS / 1200)));
  const maxTau = Math.min(cmnd.length - 2, Math.ceil(centerTau * 2 ** (TARGET_SEARCH_CENTS / 1200)));
  if (maxTau <= minTau) return null;

  let bestTau = minTau;
  let bestValue = cmnd[minTau] ?? 1;
  for (let tau = minTau + 1; tau <= maxTau; tau += 1) {
    const value = cmnd[tau] ?? 1;
    if (value < bestValue) {
      bestValue = value;
      bestTau = tau;
    }
  }
  if (bestValue > TARGET_MAX_CMNDF) return null;

  const refinedTau = parabolicTau(cmnd, bestTau);
  const hz = refinedTau > 0 ? sampleRate / refinedTau : 0;
  if (hz <= 0) return null;

  return {
    hz,
    cmndAtTau: bestValue,
    confidence: Math.max(0, Math.min(1, 1 - bestValue)),
  };
}

function rawRelation(rawHz, candidateHz, targetHz) {
  if (rawHz <= 0 || candidateHz <= 0) return null;
  if (rawHz >= candidateHz) {
    const harmonic = Math.max(1, Math.round(rawHz / candidateHz));
    if (harmonic > MAX_HARMONIC_RELATION) return null;
    const cents = Math.abs(centsBetween(rawHz, candidateHz * harmonic));
    if (cents > RAW_RELATION_MAX_CENTS) return null;
    const lowString = targetHz < 100;
    const penalty = harmonic === 1 ? 0 : lowString ? 35 + (harmonic - 2) * 10 : 22 + (harmonic - 2) * 12;
    return { kind: harmonic === 1 ? "direct" : "harmonic", multiple: harmonic, cents, penalty };
  }

  const subharmonic = Math.round(candidateHz / rawHz);
  if (subharmonic < 2 || subharmonic > MAX_HARMONIC_RELATION) return null;
  const cents = Math.abs(centsBetween(rawHz * subharmonic, candidateHz));
  if (cents > RAW_RELATION_MAX_CENTS) return null;
  return { kind: "subharmonic", multiple: subharmonic, cents, penalty: 20 + (subharmonic - 2) * 12 };
}

function resolveTargetAwarePitch(yin, sampleRate, targets, profileScores) {
  if (!yin || yin.hz <= 0 || !yin.cmnd || targets.length === 0) {
    return {
      hz: yin?.hz ?? 0,
      confidence: yin?.confidence ?? 0,
      cmndAtTau: yin?.cmndAtTau ?? 1,
      targetId: null,
      relation: null,
    };
  }

  const bestProfileScore = targets.reduce((best, target) => {
    return Math.max(best, profileScores[target.id] ?? PROFILE_FLOOR_DB);
  }, PROFILE_FLOOR_DB);

  const candidates = [];
  for (const target of targets) {
    const localCandidate = localTargetPitch(yin.cmnd, sampleRate, target.hz);
    const rawTargetCents = centsBetween(yin.hz, target.hz);
    const pitchCandidates = [
      localCandidate,
      Math.abs(rawTargetCents) <= TARGET_SEARCH_CENTS
        ? {
            hz: yin.hz,
            cmndAtTau: yin.cmndAtTau,
            confidence: yin.confidence,
          }
        : null,
    ];

    for (const candidate of pitchCandidates) {
      if (!candidate) continue;
      const targetCents = centsBetween(candidate.hz, target.hz);
      if (Math.abs(targetCents) > TARGET_SEARCH_CENTS) continue;

      const relation = rawRelation(yin.hz, candidate.hz, target.hz);
      if (!relation) continue;

      const profileScore = profileScores[target.id] ?? PROFILE_FLOOR_DB;
      const profileDeficit = Math.max(0, bestProfileScore - profileScore);
      const score =
        Math.abs(targetCents) +
        relation.penalty +
        relation.cents * 0.5 +
        profileDeficit * 4 +
        candidate.cmndAtTau * 35;

      candidates.push({
        ...candidate,
        score,
        targetId: target.id,
        relation,
        profileScore,
        targetHz: target.hz,
      });
    }
  }

  const direct = candidates
    .filter((candidate) => candidate.relation.kind === "direct")
    .sort((a, b) => a.score - b.score)[0];
  const strongestNonDirect = candidates
    .filter((candidate) => candidate.relation.kind !== "direct")
    .sort((a, b) => a.score - b.score)[0];
  const harmonicOverride =
    direct &&
    strongestNonDirect &&
    strongestNonDirect.score + 12 <= direct.score;
  const eligible = harmonicOverride && strongestNonDirect ? [strongestNonDirect] : direct ? [direct] : candidates;
  const best = eligible.sort((a, b) => a.score - b.score)[0] ?? null;

  if (!best) {
    return {
      hz: yin.hz,
      confidence: yin.confidence,
      cmndAtTau: yin.cmndAtTau,
      targetId: null,
      relation: null,
    };
  }

  return best;
}

// ---- MPM (debug fallback only) ----
function computeNsdf(input) {
  const out = new Float32Array(input.length >> 1);
  for (let tau = 0; tau < out.length; tau += 1) {
    let acf = 0;
    let div = 0;
    for (let i = 0; i < out.length; i += 1) {
      const x = input[i];
      const y = input[i + tau];
      acf += x * y;
      div += x * x + y * y;
    }
    out[tau] = div > 0 ? (2 * acf) / div : 0;
  }
  return out;
}

function parabolicPeak(buffer, index) {
  const left = buffer[index - 1] ?? buffer[index];
  const center = buffer[index];
  const right = buffer[index + 1] ?? center;
  const a = left / 2 - center + right / 2;
  if (a === 0) return { index, value: center };
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

function findPitchMPM(input, sampleRate) {
  const nsdf = computeNsdf(input);
  let lookingForMax = false;
  let maxIndex = -1;
  let maxValue = -Infinity;
  const keys = [];
  for (let i = 1; i < nsdf.length - 1; i += 1) {
    const prev = nsdf[i - 1];
    const value = nsdf[i];
    if (prev <= 0 && value > 0) {
      lookingForMax = true;
      maxIndex = i;
      maxValue = value;
    } else if (prev > 0 && value <= 0) {
      lookingForMax = false;
      if (maxIndex !== -1) keys.push(maxIndex);
    } else if (lookingForMax && value > maxValue) {
      maxValue = value;
      maxIndex = i;
    }
  }
  if (keys.length === 0) return { hz: 0, clarity: 0 };
  const maxKey = keys.reduce((b, idx) => Math.max(b, nsdf[idx]), -Infinity);
  const threshold = maxKey * 0.9;
  const picked = keys.find((idx) => nsdf[idx] >= threshold);
  if (picked == null || picked <= 0) return { hz: 0, clarity: 0 };
  const refined = parabolicPeak(nsdf, picked);
  const period = refined.index > 0 ? refined.index : picked;
  return {
    hz: sampleRate / period,
    clarity: Math.max(0, Math.min(1, refined.value)),
  };
}

class TunerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { targets = [], onsetThresholdDb = 6, onsetDebounceMs = 100, minHz = YIN_MIN_HZ, maxHz = YIN_MAX_HZ } =
      options.processorOptions || {};
    this.targets = targets;
    this.onsetThresholdDb = onsetThresholdDb;
    this.onsetDebounceMs = onsetDebounceMs;
    this.minHz = minHz;
    this.maxHz = maxHz;
    this.buffer = new Float32Array(4096);
    this.smallWindow = new Float32Array(2048);
    this.largeWindow = new Float32Array(4096);
    this.writeIndex = 0;
    this.totalSamples = 0;
    this.slowRmsDb = -120;
    this.hasSlowRms = false;
    this.lastOnsetMs = -10_000;
    this.lastOnsetSample = -100_000;
    this.hpState = 0;
    this.hpPrevInput = 0;
    this.lpState = 0;
    this.analysisCounter = 0;
    this.hzHistory = [];
    this.recentHz = [];
    this.port.onmessage = (event) => {
      if (event.data?.type === "config") {
        this.targets = event.data.targets ?? this.targets;
        this.onsetThresholdDb = event.data.onsetThresholdDb ?? this.onsetThresholdDb;
        this.onsetDebounceMs = event.data.onsetDebounceMs ?? this.onsetDebounceMs;
        this.minHz = event.data.minHz ?? this.minHz;
        this.maxHz = event.data.maxHz ?? this.maxHz;
      }
    };
  }

  copyWindowInto(out) {
    const size = out.length;
    const start = (this.writeIndex - size + this.buffer.length) % this.buffer.length;
    for (let i = 0; i < size; i += 1) {
      out[i] = this.buffer[(start + i) % this.buffer.length];
    }
    return out;
  }

  copyWindow(size) {
    return this.copyWindowInto(new Float32Array(size));
  }

  profileScores(signal) {
    const scores = {};
    const bandCache = new Map();
    const cachedBandMag = (hz) => {
      const key = Math.round(hz * 100);
      let mag = bandCache.get(key);
      if (mag === undefined) {
        mag = bandMagnitude(signal, sampleRate, hz);
        bandCache.set(key, mag);
      }
      return mag;
    };
    const cachedBandDb = (hz) => toDb(cachedBandMag(hz));

    for (const target of this.targets) {
      const lowerSameNoteTargets = this.targets
        .filter((candidate) => candidate.id !== target.id)
        .filter((candidate) => candidate.id.slice(0, -1) === target.id.slice(0, -1))
        .filter((candidate) => candidate.hz < target.hz);
      const upperSameNoteTargets = this.targets
        .filter((candidate) => candidate.id !== target.id)
        .filter((candidate) => candidate.id.slice(0, -1) === target.id.slice(0, -1))
        .filter((candidate) => candidate.hz > target.hz);
      const penalty =
        lowerSameNoteTargets.length === 0
          ? PROFILE_FLOOR_DB
          : lowerSameNoteTargets.reduce((max, candidate) => {
              return Math.max(max, cachedBandDb(candidate.hz));
            }, PROFILE_FLOOR_DB);
      const upperPenalty =
        upperSameNoteTargets.length === 0
          ? PROFILE_FLOOR_DB
          : upperSameNoteTargets.reduce((max, candidate) => {
              return Math.max(max, cachedBandDb(candidate.hz));
            }, PROFILE_FLOOR_DB);
      const fundamentalMag = cachedBandMag(target.hz);
      const secondMag = cachedBandMag(target.hz * 2);
      const thirdMag = cachedBandMag(target.hz * 3);
      const fourthMag = cachedBandMag(target.hz * 4);
      const fundamental = toDb(fundamentalMag);
      const second = toDb(secondMag);
      const fourth = toDb(fourthMag);
      const missingFundamentalPenalty = Math.max(0, second - fundamental);
      const upperOctavePenalty = Math.max(0, fourth - second);
      const lowerSameNotePenalty = Math.max(0, penalty - fundamental);
      const directUpperSameNotePenalty = Math.max(0, upperPenalty - Math.max(fundamental, second));
      const lowString = target.hz < 100;
      const harmonicTotal =
        (lowString ? 0.65 : 1) * fundamentalMag +
        (lowString ? 0.6 : 0.45) * secondMag +
        (lowString ? 0.38 : 0.2) * thirdMag +
        (lowString ? 0.18 : 0.1) * fourthMag;
      scores[target.id] =
        toDb(harmonicTotal) -
        0.55 * lowerSameNotePenalty -
        0.7 * directUpperSameNotePenalty -
        (lowString ? 0.12 : 0.28) * missingFundamentalPenalty -
        (lowString ? 0.2 : 0.55) * upperOctavePenalty;
    }
    return scores;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input) return true;

    for (let i = 0; i < input.length; i += 1) {
      const hp = input[i] - this.hpPrevInput + HIGH_PASS_POLE * this.hpState;
      this.hpPrevInput = input[i];
      this.hpState = hp;
      this.lpState = this.lpState + 0.4 * (hp - this.lpState);
      this.buffer[this.writeIndex] = this.lpState;
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
      this.totalSamples += 1;
    }

    this.analysisCounter += input.length;
    if (this.analysisCounter < 512 || this.totalSamples < 4096) {
      return true;
    }
    this.analysisCounter = 0;

    const small = this.copyWindowInto(this.smallWindow);
    const large = this.copyWindowInto(this.largeWindow);

    // Short-frame RMS / onset detection over 1 analysis hop (512 samples) so
    // low-string sub-cycle ripples do not fire spurious re-onsets.
    let sum = 0;
    let mean = 0;
    const rmsOffset = large.length - ONSET_RMS_WINDOW;
    for (let i = 0; i < ONSET_RMS_WINDOW; i += 1) {
      const sample = large[rmsOffset + i];
      sum += sample * sample;
      mean += sample;
    }
    mean /= ONSET_RMS_WINDOW;
    let variance = 0;
    for (let i = 0; i < ONSET_RMS_WINDOW; i += 1) {
      const delta = large[rmsOffset + i] - mean;
      variance += delta * delta;
    }
    variance /= ONSET_RMS_WINDOW;
    const shortRms = Math.sqrt(sum / ONSET_RMS_WINDOW);
    const shortRmsDb = toDb(shortRms);
    const nowMs = currentTime * 1000;
    if (!this.hasSlowRms) {
      this.slowRmsDb = shortRmsDb;
      this.hasSlowRms = true;
    }
    const prevSlowRmsDb = this.slowRmsDb;
    const onset =
      shortRmsDb >= ONSET_FLOOR_DB &&
      shortRmsDb - prevSlowRmsDb >= this.onsetThresholdDb &&
      nowMs - this.lastOnsetMs >= this.onsetDebounceMs;
    const hopMs = (512 / sampleRate) * 1000;
    const tauMs = shortRmsDb > prevSlowRmsDb ? 80 : 220;
    const alpha = 1 - Math.exp(-hopMs / tauMs);
    this.slowRmsDb = onset ? shortRmsDb : prevSlowRmsDb + alpha * (shortRmsDb - prevSlowRmsDb);
    if (onset) {
      this.lastOnsetMs = nowMs;
      this.lastOnsetSample = this.totalSamples;
      this.hzHistory = [];
      this.recentHz = [];
    }

    const transientSuppressed = nowMs - this.lastOnsetMs < TRANSIENT_SUPPRESS_MS;
    const samplesSinceOnset = this.totalSamples - this.lastOnsetSample;

    // YIN on both windows; after a fresh onset prefer the small window once it
    // contains post-onset audio so the large window cannot linger on the prior string.
    const yinSmall = findPitchYIN(small, sampleRate, this.minHz, this.maxHz);
    const yinLarge = findPitchYIN(large, sampleRate, this.minHz, this.maxHz);
    let preferLarge;
    if (samplesSinceOnset >= 2048 && samplesSinceOnset < 4096 && yinSmall.confidence >= 0.72) {
      if (yinSmall.hz >= 100 && yinSmall.confidence >= 0.78) {
        preferLarge = false;
      } else {
        preferLarge = yinLarge.confidence > yinSmall.confidence + 0.02;
      }
    } else {
      const nonHarmonicTransition =
        yinSmall.hz >= 100 &&
        yinSmall.confidence >= 0.85 &&
        yinLarge.hz > 0 &&
        Math.abs(centsBetween(yinSmall.hz, yinLarge.hz)) > 150 &&
        !rawRelation(yinSmall.hz, yinLarge.hz, yinLarge.hz);
      preferLarge =
        !nonHarmonicTransition &&
        (yinSmall.hz < 110 ||
          yinSmall.confidence < 0.7 ||
          yinLarge.confidence >= yinSmall.confidence - 0.03);
    }
    const yin = preferLarge ? yinLarge : yinSmall;
    const signal = preferLarge ? large : small;
    const sampleWindow = preferLarge ? 4096 : 2048;

    const stringScores = this.profileScores(signal);
    const corrected = resolveTargetAwarePitch(yin, sampleRate, this.targets, stringScores);
    const f0CandidateHz = corrected.hz;
    const confidence = corrected.confidence;
    const lowConfidence = confidence < 0.6 || transientSuppressed;

    const rawHz = yin.hz;
    const correctedHz = f0CandidateHz;
    let hz = 0;
    if (onset) {
      hz = correctedHz > 0 && confidence >= 0.65 ? correctedHz : 0;
    } else if (!transientSuppressed) {
      if (correctedHz > 0 && confidence >= 0.55) {
        const prevMedian =
          this.hzHistory.length === 0
            ? 0
            : [...this.hzHistory].sort((a, b) => a - b)[Math.floor(this.hzHistory.length / 2)];
        if (prevMedian > 0 && confidence >= 0.7 && Math.abs(centsBetween(correctedHz, prevMedian)) > 150) {
          this.hzHistory = [correctedHz];
        } else {
          this.hzHistory.push(correctedHz);
          if (this.hzHistory.length > 3) this.hzHistory.shift();
        }
      } else if (correctedHz <= 0 || confidence < 0.45) {
        this.hzHistory = [];
      }
      hz =
        this.hzHistory.length === 0
          ? 0
          : [...this.hzHistory].sort((a, b) => a - b)[Math.floor(this.hzHistory.length / 2)];
    }

    // Stable-tail: last N raw frames within STABLE_TAIL_CENTS of one another.
    if (rawHz > 0 && correctedHz > 0 && confidence >= 0.55 && !transientSuppressed) {
      this.recentHz.push(rawHz);
      if (this.recentHz.length > STABLE_TAIL_FRAMES) this.recentHz.shift();
    } else if (transientSuppressed || rawHz <= 0 || correctedHz <= 0 || confidence < 0.45) {
      this.recentHz = [];
    }
    let stableTail = false;
    if (this.recentHz.length === STABLE_TAIL_FRAMES) {
      const ref = this.recentHz[STABLE_TAIL_FRAMES - 1];
      stableTail = this.recentHz.every((value) => {
        const cents = 1200 * Math.log2(value / ref);
        return Math.abs(cents) <= STABLE_TAIL_CENTS;
      });
    }

    this.port.postMessage({
      hz,
      rawHz,
      clarity: confidence,
      rmsDb: shortRmsDb,
      shortRmsDb,
      slowRmsDb: this.slowRmsDb,
      onset,
      variance,
      amplitude: shortRms,
      sampleWindow,
      // profileScores kept as the legacy key; stringScores/candidateStringScores
      // mirror it for new consumers per the MVP plan.
      profileScores: stringScores,
      stringScores,
      candidateStringScores: stringScores,
      f0CandidateHz,
      confidence,
      lowConfidence,
      stableTail,
      transientSuppressed,
      timestampMs: nowMs,
      debug: {
        yinHz: yin.hz,
        yinConfidence: yin.confidence,
        cmndAtTau: corrected.cmndAtTau,
        rawCmndAtTau: yin.cmndAtTau,
        targetStringId: corrected.targetId,
        targetRelation: corrected.relation?.kind,
        targetRelationMultiple: corrected.relation?.multiple,
      },
    });

    return true;
  }
}

registerProcessor("tuner-processor", TunerProcessor);
