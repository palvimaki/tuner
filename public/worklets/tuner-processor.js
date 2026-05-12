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
const TRANSIENT_SUPPRESS_MS = 120;
const STABLE_TAIL_CENTS = 25;
const STABLE_TAIL_FRAMES = 3;

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

function bandDb(signal, sampleRate, hz) {
  const cents = [-25, 0, 25];
  let total = 0;
  for (const cent of cents) {
    total += goertzelMagnitude(signal, sampleRate, hz * 2 ** (cent / 1200));
  }
  return toDb(total);
}

// ---- YIN ----
function yinDifference(input, maxTau) {
  const out = new Float32Array(maxTau);
  for (let tau = 1; tau < maxTau; tau += 1) {
    let sum = 0;
    for (let i = 0; i < maxTau; i += 1) {
      const delta = input[i] - input[i + tau];
      sum += delta * delta;
    }
    out[tau] = sum;
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

function findPitchYIN(input, sampleRate) {
  const maxTau = Math.min(input.length >> 1, Math.ceil(sampleRate / YIN_MIN_HZ) + 2);
  const minTau = Math.max(2, Math.floor(sampleRate / YIN_MAX_HZ));
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
  }

  const cmndAtTau = cmnd[tauEst];
  const refined = parabolicTau(cmnd, tauEst);
  const hz = refined > 0 ? sampleRate / refined : 0;
  const confidence = Math.max(0, Math.min(1, 1 - cmndAtTau));
  return { hz, confidence, cmndAtTau };
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
    const { targets = [], onsetThresholdDb = 8, onsetDebounceMs = 140 } =
      options.processorOptions || {};
    this.targets = targets;
    this.onsetThresholdDb = onsetThresholdDb;
    this.onsetDebounceMs = onsetDebounceMs;
    this.buffer = new Float32Array(4096);
    this.writeIndex = 0;
    this.totalSamples = 0;
    this.slowRmsDb = -120;
    this.lastOnsetMs = -10_000;
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
      }
    };
  }

  copyWindow(size) {
    const out = new Float32Array(size);
    const start = (this.writeIndex - size + this.buffer.length) % this.buffer.length;
    for (let i = 0; i < size; i += 1) {
      out[i] = this.buffer[(start + i) % this.buffer.length];
    }
    return out;
  }

  profileScores(signal) {
    const scores = {};
    for (const target of this.targets) {
      const lowerSameNoteTargets = this.targets
        .filter((candidate) => candidate.id !== target.id)
        .filter((candidate) => candidate.id.slice(0, -1) === target.id.slice(0, -1))
        .filter((candidate) => candidate.hz < target.hz);
      const penalty =
        lowerSameNoteTargets.length === 0
          ? 0
          : lowerSameNoteTargets.reduce((max, candidate) => {
              return Math.max(max, bandDb(signal, sampleRate, candidate.hz));
            }, -120);
      const fundamental = bandDb(signal, sampleRate, target.hz);
      const second = bandDb(signal, sampleRate, target.hz * 2);
      const third = bandDb(signal, sampleRate, target.hz * 3);
      const fourth = bandDb(signal, sampleRate, target.hz * 4);
      const missingFundamentalPenalty = Math.max(0, second - fundamental);
      const upperOctavePenalty = Math.max(0, fourth - second);
      scores[target.id] =
        fundamental +
        0.45 * second +
        0.2 * third +
        0.1 * fourth -
        0.55 * penalty -
        0.35 * missingFundamentalPenalty -
        0.2 * upperOctavePenalty;
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

    const small = this.copyWindow(2048);
    const large = this.copyWindow(4096);

    // Short-frame RMS / onset detection runs every analysis hop.
    let sum = 0;
    let mean = 0;
    for (let i = 0; i < 256; i += 1) {
      const sample = large[large.length - 256 + i];
      sum += sample * sample;
      mean += sample;
    }
    mean /= 256;
    let variance = 0;
    for (let i = 0; i < 256; i += 1) {
      const delta = large[large.length - 256 + i] - mean;
      variance += delta * delta;
    }
    variance /= 256;
    const shortRms = Math.sqrt(sum / 256);
    const shortRmsDb = toDb(shortRms);
    const hopMs = (512 / sampleRate) * 1000;
    const alpha = 1 - Math.exp(-hopMs / 180);
    this.slowRmsDb = this.slowRmsDb + alpha * (shortRmsDb - this.slowRmsDb);
    const nowMs = currentTime * 1000;
    const onset =
      shortRmsDb >= -54 &&
      shortRmsDb - this.slowRmsDb >= this.onsetThresholdDb &&
      nowMs - this.lastOnsetMs >= this.onsetDebounceMs;
    if (onset) this.lastOnsetMs = nowMs;

    const transientSuppressed = nowMs - this.lastOnsetMs < TRANSIENT_SUPPRESS_MS;

    // YIN on both windows; pick best by confidence with a small bias toward
    // the larger window (lower error on low strings).
    const yinSmall = findPitchYIN(small, sampleRate);
    const yinLarge = findPitchYIN(large, sampleRate);
    const preferLarge =
      yinSmall.hz < 110 ||
      yinSmall.confidence < 0.7 ||
      yinLarge.confidence >= yinSmall.confidence - 0.05;
    const yin = preferLarge ? yinLarge : yinSmall;
    const signal = preferLarge ? large : small;
    const sampleWindow = preferLarge ? 4096 : 2048;

    // MPM kept as a debug-only secondary candidate.
    const mpm = findPitchMPM(signal, sampleRate);

    const f0CandidateHz = yin.hz;
    const confidence = yin.confidence;
    const lowConfidence = confidence < 0.6 || transientSuppressed;

    const rawHz = f0CandidateHz;
    if (rawHz > 0 && !transientSuppressed) {
      if (onset) this.hzHistory = [rawHz];
      else {
        this.hzHistory.push(rawHz);
        if (this.hzHistory.length > 3) this.hzHistory.shift();
      }
    } else if (!rawHz) {
      this.hzHistory = [];
    }
    const hz = this.hzHistory.length === 0
      ? 0
      : [...this.hzHistory].sort((a, b) => a - b)[Math.floor(this.hzHistory.length / 2)];

    // Stable-tail: last N raw frames within STABLE_TAIL_CENTS of one another.
    if (rawHz > 0 && !transientSuppressed) {
      this.recentHz.push(rawHz);
      if (this.recentHz.length > STABLE_TAIL_FRAMES) this.recentHz.shift();
    } else if (transientSuppressed || rawHz <= 0) {
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

    const stringScores = this.profileScores(signal);

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
        cmndAtTau: yin.cmndAtTau,
        mpmHz: mpm.hz,
        mpmClarity: mpm.clarity,
      },
    });

    return true;
  }
}

registerProcessor("tuner-processor", TunerProcessor);
