import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioEngine } from "../../src/audio/audio-engine";
import type { Instrument } from "../../src/domain/instrument";

// Regression guard for the 0.1.17 "tapping the mic does nothing" report.
// A page-lifecycle stop() that fires while start() is awaiting getUserMedia
// must leave the engine fully re-startable so the next tap recovers.

class FakeAudioContext {
  state: "suspended" | "running" | "closed" = "suspended";
  destination = {};
  closed = false;
  audioWorklet = { addModule: vi.fn(async () => undefined) };
  async resume(): Promise<void> {
    this.state = "running";
  }
  async suspend(): Promise<void> {
    this.state = "suspended";
  }
  async close(): Promise<void> {
    this.closed = true;
    this.state = "closed";
  }
  createGain() {
    return { gain: { value: 1 }, connect: (n: unknown) => n, disconnect: vi.fn() };
  }
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
}

class FakeWorkletNode {
  port = { onmessage: null as unknown, postMessage: vi.fn() };
  connect = (n: unknown) => n;
  disconnect = vi.fn();
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track] } as unknown as MediaStream;
}

const instrument = { presets: [], defaultPresetId: "x" } as unknown as Instrument;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AudioEngine restart after a lifecycle stop()", () => {
  it("aborts a start() interrupted by stop() and fully restarts on the next start()", async () => {
    const contexts: FakeAudioContext[] = [];
    class TrackedContext extends FakeAudioContext {
      constructor() {
        super();
        contexts.push(this);
      }
    }
    vi.stubGlobal("AudioContext", TrackedContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);

    let releaseGum: (s: MediaStream) => void = () => {};
    const gumPromise = new Promise<MediaStream>((resolve) => {
      releaseGum = resolve;
    });
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(() => gumPromise) },
    });

    const engine = new AudioEngine(instrument, { appVersion: "0.1.18", buildTime: "" });

    // First tap: wedges on getUserMedia (the iOS permission-prompt case).
    const firstStart = engine.start([]);
    await Promise.resolve();

    // Page-lifecycle event fires while the prompt is open.
    await engine.stop();
    expect(contexts[0].closed).toBe(true);

    // getUserMedia finally resolves into a torn-down engine; must not throw.
    releaseGum(fakeStream());
    await expect(firstStart).resolves.toBeUndefined();

    // Second tap: a fresh, fully rebuilt start must succeed.
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fakeStream(),
    );
    await engine.start([]);

    expect(contexts.length).toBe(2);
    expect(contexts[1].closed).toBe(false);
    expect(contexts[1].state).toBe("running");
  });
});
