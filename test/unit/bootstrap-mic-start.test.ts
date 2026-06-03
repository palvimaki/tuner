import { afterEach, describe, expect, it, vi } from "vitest";

import type { Instrument } from "../../src/domain/instrument";

type Listener = (event?: { type: string }) => void;

class FakeElement {
  className = "";
  hidden = false;
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
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly tagName: string) {}

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
  const documentStub = {
    hidden: false,
    createElement: (tagName: string) => new FakeElement(tagName.toLowerCase()),
    createElementNS: (_namespace: string, tagName: string) => new FakeElement(tagName.toLowerCase()),
    addEventListener: vi.fn(),
  };
  const windowStub = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout,
    clearTimeout,
  };
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
  return root;
}

function installModuleMocks(harness: Harness): void {
  vi.doMock("../../src/app/registry", () => ({
    instrumentRegistry: { guitar: instrument },
  }));
  vi.doMock("../../src/pwa/version", () => ({
    loadVersionInfo: vi.fn(async () => ({ appVersion: "0.1.19", buildTime: "" })),
    registerServiceWorker: vi.fn(async () => undefined),
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

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("bootstrap mic startup", () => {
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
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.stop).not.toHaveBeenCalled();
    expect(veil?.hidden).toBe(true);
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
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(veil?.hidden).toBe(false);
  });
});
