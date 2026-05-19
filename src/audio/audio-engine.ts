import type { Instrument } from "../domain/instrument";
import type { AnalysisFrame, AnalysisTarget } from "./frame-protocol";
import type { VersionInfo } from "../pwa/version";

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
    const context = this.context ?? new AudioContext({ latencyHint: "interactive" });
    this.context = context;
    if (context.state === "suspended") {
      await context.resume();
    }
    if (!this.processor) {
      await context.audioWorklet.addModule(
        `/worklets/tuner-processor.js?v=${this.version.appVersion}`,
      );
      // A lifecycle stop() during addModule tears the context down; abort cleanly
      // so the next user tap rebuilds from scratch instead of half-initializing.
      if (this.context !== context) return;
      const processor = new AudioWorkletNode(context, "tuner-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          onsetThresholdDb: 8,
          onsetDebounceMs: 140,
          targets,
        },
      });
      processor.port.onmessage = (event: MessageEvent<AnalysisFrame>) => this.emit(event.data);
      this.silentGain = context.createGain();
      this.silentGain.gain.value = 0;
      processor.connect(this.silentGain).connect(context.destination);
      this.processor = processor;
    }
    if (!this.stream) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      // getUserMedia can resolve after a lifecycle stop() nulled the context.
      if (this.context !== context || !this.processor) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      this.sourceNode = context.createMediaStreamSource(stream);
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

  async stop(): Promise<void> {
    this.sourceNode?.disconnect();
    this.sourceNode = null;

    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;

    this.processor?.disconnect();
    this.processor = null;
    this.silentGain?.disconnect();
    this.silentGain = null;

    const context = this.context;
    this.context = null;
    await context?.close();
  }

  async resume(): Promise<void> {
    await this.context?.resume();
  }
}
