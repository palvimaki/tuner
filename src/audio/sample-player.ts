import type { TuningPreset } from "../domain/instrument";
import { resolveReferenceSample } from "../domain/instruments/guitar/samples";
import { hzFromMidi, noteNameToMidi } from "./note-math";

function karplusStrongBuffer(
  context: BaseAudioContext,
  frequency: number,
  durationSeconds = 1.25,
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const frameCount = Math.floor(sampleRate * durationSeconds);
  const buffer = context.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);
  const delayLength = Math.max(8, Math.round(sampleRate / frequency));
  const delay = new Float32Array(delayLength);
  const pickPosition = Math.max(1, Math.floor(delayLength * 0.22));

  for (let i = 0; i < delayLength; i += 1) {
    const noise = Math.random() * 2 - 1;
    delay[i] = i % pickPosition === 0 ? noise * 0.55 : noise * 0.85;
  }

  let lp = 0;
  let ap1 = 0;
  let ap2 = 0;

  for (let i = 0; i < frameCount; i += 1) {
    const index = i % delayLength;
    const current = delay[index];
    const next = 0.5 * (current + delay[(index + 1) % delayLength]);
    lp = lp + 0.42 * (next - lp);
    const allpass = -0.18 * lp + ap1 + 0.18 * ap2;
    ap2 = ap1;
    ap1 = lp;
    delay[index] = allpass * 0.9965;
    const body = allpass + 0.18 * Math.sin((2 * Math.PI * 180 * i) / sampleRate) * Math.exp(-i / 1200);
    data[i] = body * Math.exp(-i / (sampleRate * 0.9));
  }

  return buffer;
}

export class SamplePlayer {
  private readonly buffers = new Map<string, AudioBuffer>();
  private activeReferenceTone: { oscillators: OscillatorNode[]; gain: GainNode } | null = null;

  constructor(
    private readonly context: AudioContext,
    private readonly sampleMap: Record<string, string>,
  ) {}

  async load(): Promise<void> {
    const entries = Object.entries(this.sampleMap);
    await Promise.all(
      entries.map(async ([note, url]) => {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Failed sample fetch: ${url}`);
          const arrayBuffer = await response.arrayBuffer();
          const buffer = await this.context.decodeAudioData(arrayBuffer.slice(0));
          this.buffers.set(note, buffer);
        } catch {
          this.buffers.set(note, karplusStrongBuffer(this.context, hzFromMidi(noteNameToMidi(note))));
        }
      }),
    );
  }

  private createVoice(buffer: AudioBuffer, when: number, detuneCents = 0, gainValue = 0.32): void {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.detune.value = detuneCents;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 1.1);
    source.connect(gain).connect(this.context.destination);
    source.start(when);
    source.stop(when + 1.15);
  }

  private createSampleReference(noteName: string, atTime = this.context.currentTime): void {
    const mapping = resolveReferenceSample(noteName);
    const baseBuffer =
      this.buffers.get(mapping.baseId) ??
      karplusStrongBuffer(this.context, hzFromMidi(noteNameToMidi(noteName)));
    this.createVoice(baseBuffer, atTime, mapping.detuneCents, 0.34);
  }

  private stopActiveReferenceTone(atTime = this.context.currentTime): void {
    if (!this.activeReferenceTone) return;

    const { oscillators, gain } = this.activeReferenceTone;
    gain.gain.cancelScheduledValues(atTime);
    gain.gain.setTargetAtTime(0.0001, atTime, 0.025);
    oscillators.forEach((oscillator) => {
      try {
        oscillator.stop(atTime + 0.15);
      } catch {
        // The node may already have been stopped by a prior scheduled release.
      }
    });
    this.activeReferenceTone = null;
  }

  private createReferenceTone(frequency: number, atTime = this.context.currentTime): void {
    const start = Math.max(atTime, this.context.currentTime);
    const attackSeconds = 0.035;
    const holdSeconds = 3.2;
    const durationSeconds = 5.2;
    const gainValue = 0.18;

    this.stopActiveReferenceTone(start);

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + attackSeconds);
    gain.gain.setValueAtTime(gainValue, start + holdSeconds);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSeconds);

    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(start);
    oscillator.stop(start + durationSeconds + 0.05);

    const activeTone = { oscillators: [oscillator], gain };
    this.activeReferenceTone = activeTone;
    oscillator.onended = () => {
      if (this.activeReferenceTone === activeTone) this.activeReferenceTone = null;
    };
  }

  playReference(noteName: string, frequency = hzFromMidi(noteNameToMidi(noteName))): void {
    this.createReferenceTone(frequency);
  }

  playLockPing(): void {
    const now = this.context.currentTime;
    [
      { hz: 1046.5, start: 0, duration: 0.18, gain: 0.09 },
      { hz: 1318.51, start: 0.08, duration: 0.22, gain: 0.075 },
    ].forEach((tone) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const start = now + tone.start;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(tone.hz, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
      oscillator.connect(gain).connect(this.context.destination);
      oscillator.start(start);
      oscillator.stop(start + tone.duration + 0.02);
    });
  }

  playCompletionStrum(preset: TuningPreset): void {
    preset.strings.forEach((stringDef, index) => {
      this.createSampleReference(stringDef.id, this.context.currentTime + index * 0.035);
    });
  }
}
