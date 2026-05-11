/*!
 * Adapted McLeod Pitch Method implementation derived from pitchy 4.1.0
 * (https://github.com/ianprime0509/pitchy).
 *
 * Copyright Ian Johnson — Licensed under the ISC License.
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose
 * with or without fee is hereby granted.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
 * OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 * TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
 * THIS SOFTWARE.
 */

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
  return Math.sqrt(q1 * q1 + q2 * q2 - coeff * q1 * q2);
}

function bandDb(signal, sampleRate, hz) {
  const cents = [-25, 0, 25];
  let total = 0;
  for (const cent of cents) {
    total += goertzelMagnitude(signal, sampleRate, hz * 2 ** (cent / 1200));
  }
  return toDb(total);
}

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

const MPM_CLARITY_THRESHOLD = 0.9;

function collectKeyMaximumIndices(nsdf) {
  const keyIndices = [];
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
      if (maxIndex !== -1) keyIndices.push(maxIndex);
    } else if (lookingForMaximum && value > maxValue) {
      maxValue = value;
      maxIndex = i;
    }
  }

  return keyIndices;
}

function pickPeak(nsdf) {
  const keyMaximumIndices = collectKeyMaximumIndices(nsdf);
  if (keyMaximumIndices.length === 0) return -1;

  const maxKeyMaximum = keyMaximumIndices.reduce((best, index) => {
    return Math.max(best, nsdf[index] ?? 0);
  }, -Infinity);
  const threshold = maxKeyMaximum * MPM_CLARITY_THRESHOLD;
  return keyMaximumIndices.find((index) => (nsdf[index] ?? 0) >= threshold) ?? -1;
}

function findPitchMPM(input, sampleRate) {
  const nsdf = computeNsdf(input);
  const peakIndex = pickPeak(nsdf);
  if (peakIndex <= 0) return { hz: 0, clarity: 0 };
  const refined = parabolicPeak(nsdf, peakIndex);
  const period = refined.index > 0 ? refined.index : peakIndex;
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
      const penalty = lowerSameNoteTargets.reduce((max, candidate) => {
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
      const hp = input[i] - this.hpPrevInput + 0.992 * this.hpState;
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
    const resultSmall = findPitchMPM(small, sampleRate);
    const resultLarge = findPitchMPM(large, sampleRate);
    const useLarge =
      resultSmall.hz < 110 || resultSmall.clarity < 0.86 || resultLarge.hz < 110;
    const selected = useLarge ? resultLarge : resultSmall;
    const signal = useLarge ? large : small;

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

    const rawHz = selected.hz;
    if (rawHz > 0) {
      if (onset) this.hzHistory = [rawHz];
      else {
        this.hzHistory.push(rawHz);
        if (this.hzHistory.length > 3) this.hzHistory.shift();
      }
    } else {
      this.hzHistory = [];
    }
    const hz = this.hzHistory.length === 0
      ? 0
      : [...this.hzHistory].sort((a, b) => a - b)[Math.floor(this.hzHistory.length / 2)];

    this.port.postMessage({
      hz,
      rawHz,
      clarity: selected.clarity,
      rmsDb: shortRmsDb,
      shortRmsDb,
      slowRmsDb: this.slowRmsDb,
      onset,
      variance,
      amplitude: shortRms,
      sampleWindow: useLarge ? 4096 : 2048,
      profileScores: this.profileScores(signal),
      timestampMs: nowMs,
    });

    return true;
  }
}

registerProcessor("tuner-processor", TunerProcessor);
