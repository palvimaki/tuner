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

  playReference(noteName: string, atTime = this.context.currentTime): void {
    const mapping = resolveReferenceSample(noteName);
    const baseBuffer =
      this.buffers.get(mapping.baseId) ??
      karplusStrongBuffer(this.context, hzFromMidi(noteNameToMidi(noteName)));
    this.createVoice(baseBuffer, atTime, mapping.detuneCents, 0.34);
  }

  playLockPing(): void {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(1046.5, this.context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1567.98, this.context.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, this.context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + 0.24);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start();
    oscillator.stop(this.context.currentTime + 0.26);
  }

  playCompletionStrum(preset: TuningPreset): void {
    preset.strings.forEach((stringDef, index) => {
      this.playReference(stringDef.id, this.context.currentTime + index * 0.035);
    });
  }
}
