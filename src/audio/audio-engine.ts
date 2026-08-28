import type { Instrument } from "../domain/instrument";
import type { AnalysisFrame, AnalysisTarget } from "./frame-protocol";
import type { VersionInfo } from "../pwa/version";

const DEFAULT_YIN_MIN_HZ = 55;
const DEFAULT_YIN_MAX_HZ = 1400;

// Convert the instrument's configured frequency range into YIN search bounds.
// Lower the floor only when the instrument needs it (e.g. bass E1 ≈ 41 Hz);
// instruments whose low end is at/above the default keep the tested 55 Hz floor
// so their detection behaviour is unchanged. The upper bound stays wide —
// target-aware correction narrows the real search.
function rangeToBounds(rangeHz?: [number, number]): { minHz: number; maxHz: number } {
  if (!rangeHz) return { minHz: DEFAULT_YIN_MIN_HZ, maxHz: DEFAULT_YIN_MAX_HZ };
  const minHz = rangeHz[0] < DEFAULT_YIN_MIN_HZ ? Math.max(20, rangeHz[0] * 0.8) : DEFAULT_YIN_MIN_HZ;
  return { minHz, maxHz: DEFAULT_YIN_MAX_HZ };
}

type FrameListener = (frame: AnalysisFrame) => void;

function unsupportedAudioError(): DOMException {
  return new DOMException("This browser cannot start the tuner microphone.", "NotSupportedError");
}

function assertAudioSupport(): void {
  if (
    typeof navigator === "undefined"
    || !navigator.mediaDevices
    || typeof navigator.mediaDevices.getUserMedia !== "function"
    || typeof AudioContext === "undefined"
    || typeof AudioWorkletNode === "undefined"
  ) {
    throw unsupportedAudioError();
  }
}

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
    assertAudioSupport();
    let context = this.context;
    if (!context) {
      try {
        context = new AudioContext({ latencyHint: "interactive" });
      } catch (error) {
        if (error instanceof TypeError) throw unsupportedAudioError();
        throw error;
      }
      this.context = context;
    }
    if (!context.audioWorklet || typeof context.audioWorklet.addModule !== "function") {
      throw unsupportedAudioError();
    }
    if (context.state === "suspended") {
      await context.resume();
      // iOS standalone can suspend/tear down the page while resume() is
      // pending. Do not continue bootstrapping a closed or replaced context.
      const stateAfterResume = (context as { readonly state: AudioContextState }).state;
      if (this.context !== context || stateAfterResume === "closed") return;
      if (stateAfterResume !== "running") return;
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
          ...rangeToBounds(this.instrument.analysis?.rangeHz),
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
      ...rangeToBounds(this.instrument.analysis?.rangeHz),
    });
  }

  isRunning(): boolean {
    return this.context?.state === "running";
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
