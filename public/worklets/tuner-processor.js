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
const TARGET_SEARCH_CENTS = 140;
const TARGET_MAX_CMNDF = 0.45;
const RAW_RELATION_MAX_CENTS = 45;
const MAX_HARMONIC_RELATION = 4;
const PROFILE_FLOOR_DB = -180;

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

function cmndAtHz(cmnd, sampleRate, hz) {
  if (hz <= 0) return 1;
  const tau = Math.round(sampleRate / hz);
  if (tau <= 0 || tau >= cmnd.length) return 1;
  return cmnd[tau] ?? 1;
}

function displayHzFromRelation(rawHz, candidateHz, relation) {
  if (relation.kind === "harmonic") return rawHz / relation.multiple;
  if (relation.kind === "subharmonic") return rawHz * relation.multiple;
  return candidateHz;
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
      const displayHz = displayHzFromRelation(yin.hz, candidate.hz, relation);
      if (displayHz <= 0) continue;
      const displayTargetCents = centsBetween(displayHz, target.hz);
      if (Math.abs(displayTargetCents) > TARGET_SEARCH_CENTS) continue;
      const displayCmndAtTau =
        relation.kind === "direct"
          ? candidate.cmndAtTau
          : cmndAtHz(yin.cmnd, sampleRate, displayHz);

      candidates.push({
        ...candidate,
        hz: displayHz,
        confidence: Math.max(0, Math.min(1, 1 - displayCmndAtTau)),
        cmndAtTau: displayCmndAtTau,
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
    this.lastTargetId = null;
    this.port.onmessage = (event) => {
      if (event.data?.type === "config") {
        this.targets = event.data.targets ?? this.targets;
        this.onsetThresholdDb = event.data.onsetThresholdDb ?? this.onsetThresholdDb;
        this.onsetDebounceMs = event.data.onsetDebounceMs ?? this.onsetDebounceMs;
        this.resetPitchTracking();
      }
    };
  }

  resetPitchTracking() {
    this.hzHistory = [];
    this.recentHz = [];
    this.lastTargetId = null;
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
      const upperSameNoteTargets = this.targets
        .filter((candidate) => candidate.id !== target.id)
        .filter((candidate) => candidate.id.slice(0, -1) === target.id.slice(0, -1))
        .filter((candidate) => candidate.hz > target.hz);
      const penalty =
        lowerSameNoteTargets.length === 0
          ? PROFILE_FLOOR_DB
          : lowerSameNoteTargets.reduce((max, candidate) => {
              return Math.max(max, bandDb(signal, sampleRate, candidate.hz));
            }, PROFILE_FLOOR_DB);
      const upperPenalty =
        upperSameNoteTargets.length === 0
          ? PROFILE_FLOOR_DB
          : upperSameNoteTargets.reduce((max, candidate) => {
              return Math.max(max, bandDb(signal, sampleRate, candidate.hz));
            }, PROFILE_FLOOR_DB);
      const fundamentalMag = bandMagnitude(signal, sampleRate, target.hz);
      const secondMag = bandMagnitude(signal, sampleRate, target.hz * 2);
      const thirdMag = bandMagnitude(signal, sampleRate, target.hz * 3);
      const fourthMag = bandMagnitude(signal, sampleRate, target.hz * 4);
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

    const stringScores = this.profileScores(signal);
    const corrected = resolveTargetAwarePitch(yin, sampleRate, this.targets, stringScores);
    const f0CandidateHz = corrected.hz;
    const confidence = corrected.confidence;
    const lowConfidence = confidence < 0.6 || transientSuppressed;

    const rawHz = yin.hz;
    const correctedHz = f0CandidateHz;
    const correctedTargetId = corrected.targetId ?? null;
    const targetChanged =
      correctedTargetId !== null &&
      this.lastTargetId !== null &&
      correctedTargetId !== this.lastTargetId;
    if (onset || targetChanged) {
      this.hzHistory = [];
      this.recentHz = [];
    }
    if (correctedHz > 0 && !transientSuppressed) {
      this.hzHistory.push(correctedHz);
      if (this.hzHistory.length > 3) this.hzHistory.shift();
    } else if (!correctedHz) {
      this.resetPitchTracking();
    }
    if (correctedTargetId !== null && correctedHz > 0) {
      this.lastTargetId = correctedTargetId;
    }
    const historyHz = this.hzHistory.length === 0
      ? 0
      : [...this.hzHistory].sort((a, b) => a - b)[Math.floor(this.hzHistory.length / 2)];
    const hz = transientSuppressed ? correctedHz : historyHz;

    // Stable-tail: last N raw frames within STABLE_TAIL_CENTS of one another.
    if (rawHz > 0 && correctedHz > 0 && !transientSuppressed) {
      this.recentHz.push(rawHz);
      if (this.recentHz.length > STABLE_TAIL_FRAMES) this.recentHz.shift();
    } else if (transientSuppressed || rawHz <= 0 || correctedHz <= 0) {
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
        mpmHz: mpm.hz,
        mpmClarity: mpm.clarity,
        targetStringId: corrected.targetId,
        targetRelation: corrected.relation?.kind,
        targetRelationMultiple: corrected.relation?.multiple,
      },
    });

    return true;
  }
}

registerProcessor("tuner-processor", TunerProcessor);
