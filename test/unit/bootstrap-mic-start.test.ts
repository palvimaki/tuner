import { afterEach, describe, expect, it, vi } from "vitest";

import type { Instrument } from "../../src/domain/instrument";

type Listener = (event?: { type: string }) => void;

class FakeEventTarget {
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type });
    }
  }
}

class FakeElement extends FakeEventTarget {
  className = "";
  hidden = false;
  disabled = false;
  type = "";
  textContent = "";
  innerHTML = "";
  href = "";
  target = "";
  rel = "";
  id = "";
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style = {
    setProperty: vi.fn(),
  };
  constructor(readonly tagName: string) {
    super();
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  appendChild(node: FakeElement): FakeElement {
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...nodes);
  }

  setAttribute(name: string, value: string): void {
    if (name === "id") this.id = value;
    Reflect.set(this, name, value);
  }

  override dispatch(type: string): void {
    if (this.disabled) return;
    super.dispatch(type);
  }

  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.find((node) => node.className.split(/\s+/).includes(className));
    }
    return this.find((node) => node.tagName === selector.toLowerCase());
  }

  private find(predicate: (node: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.find(predicate);
      if (nested) return nested;
    }
    return null;
  }
}

interface MockEngine {
  start: ReturnType<typeof vi.fn<() => Promise<void>>>;
  stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
  isRunning: ReturnType<typeof vi.fn<() => boolean>>;
  setTargets: ReturnType<typeof vi.fn>;
  onFrame: ReturnType<typeof vi.fn>;
}

interface Harness {
  root: FakeElement;
  engines: MockEngine[];
  startResolvers: Array<() => void>;
}

let fakeDocument: FakeEventTarget & { hidden: boolean };
let fakeWindow: FakeEventTarget;

const instrument: Instrument = {
  id: "guitar",
  family: "guitar",
  defaultPresetId: "standard",
  analysis: { rangeHz: [70, 400], onsetMode: "sustained" },
  presets: [
    {
      id: "standard",
      name: "Standard",
      strings: [{ id: "E2", midi: 40, hz: 82.41 }],
    },
  ],
};

function installDom(options: { micGranted?: boolean } = {}): FakeElement {
  const root = new FakeElement("div");
  const documentStub = Object.assign(new FakeEventTarget(), {
    hidden: false,
    createElement: (tagName: string) => new FakeElement(tagName.toLowerCase()),
    createElementNS: (_namespace: string, tagName: string) => new FakeElement(tagName.toLowerCase()),
  });
  const windowStub = Object.assign(new FakeEventTarget(), {
    removeEventListener: vi.fn(),
    setTimeout,
    clearTimeout,
  });
  const localStorageState = new Map<string, string>(
    options.micGranted ? [["tuner:mic-granted", "1"]] : [],
  );
  const localStorageStub = {
    getItem: (key: string) => localStorageState.get(key) ?? null,
    setItem: (key: string, value: string) => {
      localStorageState.set(key, value);
    },
  };

  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal("localStorage", localStorageStub);
  vi.stubGlobal("performance", { now: () => 1000 });
  fakeDocument = documentStub;
  fakeWindow = windowStub;
  return root;
}

function installModuleMocks(harness: Harness): void {
  vi.doMock("../../src/app/registry", () => ({
    instrumentRegistry: { guitar: instrument },
  }));
  vi.doMock("../../src/pwa/version", () => ({
    loadVersionInfo: vi.fn(async () => ({ appVersion: "0.1.19", buildTime: "" })),
    registerServiceWorker: vi.fn(async () => undefined),
    enableServiceWorkerAutoReload: vi.fn(() => undefined),
  }));
  vi.doMock("../../src/pwa/wake-lock", () => ({
    requestWakeLock: vi.fn(async () => undefined),
    releaseWakeLock: vi.fn(async () => undefined),
  }));
  vi.doMock("../../src/ui/controls", () => ({
    createControls: vi.fn(() => ({
      root: new FakeElement("div"),
      setInstallPulse: vi.fn(),
      setPulse: vi.fn(),
      setActivePreset: vi.fn(),
      setStringLabels: vi.fn(),
    })),
  }));
  vi.doMock("../../src/ui/renderer", () => ({
    Renderer: class {
      setState = vi.fn();
    },
  }));
  vi.doMock("../../src/ui/scene", () => ({
    buildRenderState: vi.fn(() => ({
      mode: "idle",
      strings: [],
      pulsePicker: false,
      celebrationProgress: 0,
    })),
  }));
  vi.doMock("../../src/audio/audio-engine", () => ({
    AudioEngine: class {
      start = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            harness.startResolvers.push(resolve);
          }),
      );
      stop = vi.fn(async () => undefined);
      isRunning = vi.fn(() => true);
      setTargets = vi.fn();
      onFrame = vi.fn();

      constructor() {
        harness.engines.push(this as MockEngine);
      }
    },
  }));
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("bootstrap mic startup", () => {
  it("places the microphone state label below the microphone button", async () => {
    const harness: Harness = {
      root: installDom(),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);

    const activation = harness.root.querySelector(".mic-activation");
    const micButton = harness.root.querySelector(".mic-button");
    const label = harness.root.querySelector(".mic-button-label");

    expect(activation?.children).toEqual([
      micButton,
      label,
      harness.root.querySelector(".mic-recovery"),
    ]);
    expect(micButton?.children).not.toContain(label);
  });

  it("lets a user tap replace a pending automatic mic start", async () => {
    const harness: Harness = {
      root: installDom({ micGranted: true }),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);
    const engine = harness.engines[0];
    expect(engine.start).toHaveBeenCalledTimes(1);

    const micButton = harness.root.querySelector(".mic-button");
    expect(micButton).not.toBeNull();
    micButton?.dispatch("pointerup");

    expect(engine.stop).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    expect(engine.start).toHaveBeenCalledTimes(2);

    harness.startResolvers.forEach((resolve) => resolve());
    await Promise.resolve();
  });

  it("opens the tuner as soon as a user-started microphone request succeeds", async () => {
    const harness: Harness = {
      root: installDom(),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);
    const engine = harness.engines[0];
    const veil = harness.root.querySelector(".glass-veil");
    const micButton = harness.root.querySelector(".mic-button");

    expect(engine.start).not.toHaveBeenCalled();
    expect(veil?.hidden).toBe(false);

    micButton?.dispatch("pointerup");
    expect(engine.start).toHaveBeenCalledTimes(1);

    harness.startResolvers[0]?.();
    await flushMicrotasks();

    expect(engine.stop).not.toHaveBeenCalled();
    expect(veil?.hidden).toBe(true);
  });

  it("shows progress immediately and recovers after a pending user start times out", async () => {
    vi.useFakeTimers();
    const harness: Harness = {
      root: installDom(),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);
    const engine = harness.engines[0];
    harness.root.querySelector(".mic-button")?.dispatch("pointerup");

    expect(harness.root.querySelector(".mic-button-label")?.textContent).toBe("Starting microphone...");
    expect(harness.root.querySelector(".mic-recovery")?.textContent).toBe("Waiting for microphone access.");

    await vi.advanceTimersByTimeAsync(20_000);

    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(harness.root.querySelector(".mic-recovery")?.textContent).toContain("did not start");
    expect(harness.root.querySelector(".mic-button-label")?.textContent).toBe("Try again");
  });

  it("starts a new request after a user denies microphone access", async () => {
    const harness: Harness = {
      root: installDom(),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);
    const engine = harness.engines[0];
    const micButton = harness.root.querySelector(".mic-button");
    engine.start.mockRejectedValueOnce(Object.assign(new Error("Permission denied"), {
      name: "NotAllowedError",
    }));

    micButton?.dispatch("pointerup");
    await flushMicrotasks();

    const recovery = harness.root.querySelector(".mic-recovery");
    expect(recovery?.hidden).toBe(false);
    expect(recovery?.textContent).toContain("Allow microphone access");
    expect(harness.root.querySelector(".mic-button-label")?.textContent).toBe("Try again");

    micButton?.dispatch("pointerup");

    expect(engine.start).toHaveBeenCalledTimes(2);
  });

  it("keeps retry disabled until cleanup completes, then starts a new request", async () => {
    const harness: Harness = {
      root: installDom(),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);
    const engine = harness.engines[0];
    const micButton = harness.root.querySelector(".mic-button");
    let finishStop: (() => void) | undefined;
    engine.start.mockRejectedValueOnce(Object.assign(new Error("Permission denied"), {
      name: "NotAllowedError",
    }));
    engine.stop.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishStop = resolve;
    }));

    micButton?.dispatch("pointerup");
    await flushMicrotasks();

    expect(micButton?.disabled).toBe(true);
    expect(harness.root.querySelector(".mic-button-label")?.textContent).toBe("Starting microphone...");
    micButton?.dispatch("pointerup");
    expect(engine.start).toHaveBeenCalledTimes(1);

    finishStop?.();
    await flushMicrotasks();

    expect(micButton?.disabled).toBe(false);
    expect(harness.root.querySelector(".mic-button-label")?.textContent).toBe("Try again");
    micButton?.dispatch("pointerup");
    expect(engine.start).toHaveBeenCalledTimes(2);
  });

  it("recovers after visibilitychange hides a pending user start", async () => {
    const harness: Harness = {
      root: installDom(),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);
    const engine = harness.engines[0];
    const micButton = harness.root.querySelector(".mic-button");
    let finishStop: (() => void) | undefined;
    engine.stop.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishStop = resolve;
    }));

    micButton?.dispatch("pointerup");
    fakeDocument.hidden = true;
    fakeDocument.dispatch("visibilitychange");

    expect(micButton?.disabled).toBe(true);
    micButton?.dispatch("pointerup");
    expect(engine.start).toHaveBeenCalledTimes(1);

    finishStop?.();
    await flushMicrotasks();

    expect(micButton?.disabled).toBe(false);
    expect(harness.root.querySelector(".mic-button-label")?.textContent).toBe("Try again");
    micButton?.dispatch("pointerup");
    expect(engine.start).toHaveBeenCalledTimes(2);
  });

  it("recovers after pagehide interrupts a pending user start", async () => {
    const harness: Harness = {
      root: installDom(),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);
    const engine = harness.engines[0];
    const micButton = harness.root.querySelector(".mic-button");
    let finishStop: (() => void) | undefined;
    engine.stop.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishStop = resolve;
    }));

    micButton?.dispatch("pointerup");
    fakeWindow.dispatch("pagehide");

    expect(micButton?.disabled).toBe(true);
    micButton?.dispatch("pointerup");
    expect(engine.start).toHaveBeenCalledTimes(1);

    harness.startResolvers[0]?.();
    await flushMicrotasks();

    expect(micButton?.disabled).toBe(true);

    finishStop?.();
    await flushMicrotasks();

    expect(micButton?.disabled).toBe(false);
    expect(harness.root.querySelector(".mic-button-label")?.textContent).toBe("Try again");
    micButton?.dispatch("pointerup");
    expect(engine.start).toHaveBeenCalledTimes(2);
  });

  it("shows busy microphone recovery copy", async () => {
    const harness: Harness = {
      root: installDom(),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);
    const engine = harness.engines[0];
    engine.start.mockRejectedValueOnce(Object.assign(new Error("Microphone busy"), {
      name: "NotReadableError",
    }));

    harness.root.querySelector(".mic-button")?.dispatch("pointerup");
    await flushMicrotasks();

    expect(harness.root.querySelector(".mic-recovery")?.textContent).toBe(
      "Your microphone is busy. Close other apps, then tap Try again.",
    );
  });

  it("shows unsupported browser recovery copy", async () => {
    const harness: Harness = {
      root: installDom(),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);
    const engine = harness.engines[0];
    engine.start.mockRejectedValueOnce(Object.assign(new Error("Unsupported"), {
      name: "NotSupportedError",
    }));

    harness.root.querySelector(".mic-button")?.dispatch("pointerup");
    await flushMicrotasks();

    expect(harness.root.querySelector(".mic-recovery")?.textContent).toBe(
      "This browser does not support microphone access. Use a supported browser, then tap Try again.",
    );
  });

  it("starts once for the pointerup and click from one physical tap", async () => {
    const harness: Harness = {
      root: installDom(),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);
    const engine = harness.engines[0];
    const micButton = harness.root.querySelector(".mic-button");

    micButton?.dispatch("pointerup");
    micButton?.dispatch("click");

    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it("starts from a keyboard click", async () => {
    const harness: Harness = {
      root: installDom(),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);
    const engine = harness.engines[0];

    harness.root.querySelector(".mic-button")?.dispatch("click");

    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it("keeps the mic affordance when an automatic start does not run the audio context", async () => {
    const harness: Harness = {
      root: installDom({ micGranted: true }),
      engines: [],
      startResolvers: [],
    };
    installModuleMocks(harness);
    const { bootstrapApp } = await import("../../src/app/bootstrap");

    await bootstrapApp(harness.root as unknown as HTMLElement);
    const engine = harness.engines[0];
    const veil = harness.root.querySelector(".glass-veil");
    engine.isRunning.mockReturnValue(false);

    harness.startResolvers[0]?.();
    await flushMicrotasks();

    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(veil?.hidden).toBe(false);
    expect(harness.root.querySelector(".mic-recovery")?.textContent).toContain("did not start");
    expect(harness.root.querySelector(".mic-button-label")?.textContent).toBe("Try again");
  });
});
