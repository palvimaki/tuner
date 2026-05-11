/*!
 * Adapted McLeod Pitch Method implementation derived from pitchy 4.1.0.
 *
 * MIT License
 *
 * Copyright (c) 2022 Ross Bencina
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
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
  const denominator = left - 2 * center + right;
  if (denominator === 0) return index;
  return index + (left - right) / (2 * denominator);
}

function pickPeak(nsdf) {
  let bestIndex = -1;
  let bestValue = 0;
  let seenPositive = false;
  for (let i = 1; i < nsdf.length - 1; i += 1) {
    const value = nsdf[i];
    if (value > 0) seenPositive = true;
    if (seenPositive && value > bestValue && value > nsdf[i - 1] && value >= nsdf[i + 1]) {
      bestIndex = i;
      bestValue = value;
    }
  }
  return bestIndex;
}

function findPitchMPM(input, sampleRate) {
  const nsdf = computeNsdf(input);
  const peakIndex = pickPeak(nsdf);
  if (peakIndex <= 0) return { hz: 0, clarity: 0 };
  const refined = parabolicPeak(nsdf, peakIndex);
  const period = refined > 0 ? refined : peakIndex;
  return {
    hz: sampleRate / period,
    clarity: Math.max(0, Math.min(1, nsdf[peakIndex] || 0)),
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
      this.lpState = this.lpState + 0.16 * (hp - this.lpState);
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
      shortRmsDb >= -48 &&
      shortRmsDb - this.slowRmsDb >= this.onsetThresholdDb &&
      nowMs - this.lastOnsetMs >= this.onsetDebounceMs;

    if (onset) this.lastOnsetMs = nowMs;

    this.port.postMessage({
      hz: selected.hz,
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
