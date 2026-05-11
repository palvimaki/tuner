import type { Instrument } from "../domain/instrument";
import type { AnalysisFrame, AnalysisTarget } from "./frame-protocol";
import type { VersionInfo } from "../pwa/version";
import { SamplePlayer } from "./sample-player";

interface LiveInputWaitOptions {
  timeoutMs: number;
  minLiveFrames: number;
  minVariance: number;
}

type FrameListener = (frame: AnalysisFrame) => void;

export class AudioEngine {
  private context: AudioContext | null = null;
  private processor: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private silentGain: GainNode | null = null;
  private stream: MediaStream | null = null;
  private samplePlayer: SamplePlayer | null = null;
  private readonly listeners = new Set<FrameListener>();

  constructor(
    private readonly instrument: Instrument,
    private readonly version: VersionInfo,
  ) {}

  onFrame(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(frame: AnalysisFrame): void {
    for (const listener of this.listeners) {
      listener(frame);
    }
  }

  async start(targets: AnalysisTarget[]): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    if (!this.processor) {
      await this.context.audioWorklet.addModule(
        `/worklets/tuner-processor.js?v=${this.version.appVersion}`,
      );
      this.processor = new AudioWorkletNode(this.context, "tuner-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          onsetThresholdDb: 8,
          onsetDebounceMs: 140,
          targets,
        },
      });
      this.processor.port.onmessage = (event: MessageEvent<AnalysisFrame>) => this.emit(event.data);
      this.silentGain = this.context.createGain();
      this.silentGain.gain.value = 0;
      this.processor.connect(this.silentGain).connect(this.context.destination);
    }
    if (!this.samplePlayer) {
      this.samplePlayer = new SamplePlayer(this.context, this.instrument.sampleMap);
      await this.samplePlayer.load();
    }
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.sourceNode = this.context.createMediaStreamSource(this.stream);
      this.sourceNode.connect(this.processor);
    }
    this.setTargets(targets);
  }

  setTargets(targets: AnalysisTarget[]): void {
    this.processor?.port.postMessage({
      type: "config",
      targets,
      onsetThresholdDb: 8,
      onsetDebounceMs: 140,
    });
  }

  async waitForLiveInput(options: LiveInputWaitOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let liveFrames = 0;
      const off = this.onFrame((frame) => {
        if (frame.variance >= options.minVariance) {
          liveFrames += 1;
        }
        if (liveFrames >= options.minLiveFrames) {
          clearTimeout(timer);
          off();
          resolve(true);
        }
      });
      const timer = window.setTimeout(() => {
        off();
        resolve(false);
      }, options.timeoutMs);
    });
  }

  async suspend(): Promise<void> {
    await this.context?.suspend();
  }

  async resume(): Promise<void> {
    await this.context?.resume();
  }

  playReference(noteName: string): void {
    this.samplePlayer?.playReference(noteName);
  }

  playLockPing(): void {
    this.samplePlayer?.playLockPing();
  }

  playCompletionStrum(preset: Parameters<SamplePlayer["playCompletionStrum"]>[0]): void {
    this.samplePlayer?.playCompletionStrum(preset);
  }
}
