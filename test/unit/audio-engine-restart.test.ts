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
  it("classifies unavailable browser audio capability as unsupported", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    vi.stubGlobal("navigator", { mediaDevices: {} });

    const engine = new AudioEngine(instrument, { appVersion: "0.1.20", buildTime: "" });

    await expect(engine.start([])).rejects.toMatchObject({ name: "NotSupportedError" });
  });

  it("classifies a missing audio worklet node as unsupported", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", undefined);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => fakeStream()) },
    });

    const engine = new AudioEngine(instrument, { appVersion: "0.1.20", buildTime: "" });

    await expect(engine.start([])).rejects.toMatchObject({ name: "NotSupportedError" });
  });

  it("aborts start() when AudioContext.resume() resolves without running", async () => {
    const contexts: FakeAudioContext[] = [];
    class RefusedResumeContext extends FakeAudioContext {
      constructor() {
        super();
        contexts.push(this);
      }
      async resume(): Promise<void> {
        this.state = "suspended";
      }
    }
    vi.stubGlobal("AudioContext", RefusedResumeContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => fakeStream()) },
    });

    const engine = new AudioEngine(instrument, { appVersion: "0.1.19", buildTime: "" });

    await engine.start([]);

    expect(engine.isRunning()).toBe(false);
    expect(contexts[0].audioWorklet.addModule).not.toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("aborts a start() interrupted while AudioContext.resume() is pending", async () => {
    const contexts: FakeAudioContext[] = [];
    let releaseResume: () => void = () => {};
    let holdNextResume = true;
    class PendingResumeContext extends FakeAudioContext {
      constructor() {
        super();
        contexts.push(this);
      }
      async resume(): Promise<void> {
        if (holdNextResume) {
          holdNextResume = false;
          await new Promise<void>((resolve) => {
            releaseResume = resolve;
          });
        }
        if (!this.closed) {
          this.state = "running";
        }
      }
    }
    vi.stubGlobal("AudioContext", PendingResumeContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => fakeStream()) },
    });

    const engine = new AudioEngine(instrument, { appVersion: "0.1.19", buildTime: "" });

    const firstStart = engine.start([]);
    await Promise.resolve();
    await engine.stop();
    releaseResume();
    await expect(firstStart).resolves.toBeUndefined();

    expect(contexts[0].closed).toBe(true);
    expect(contexts[0].audioWorklet.addModule).not.toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();

    await engine.start([]);

    expect(contexts.length).toBe(2);
    expect(contexts[1].closed).toBe(false);
    expect(contexts[1].state).toBe("running");
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

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
