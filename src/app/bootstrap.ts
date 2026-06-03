import { AudioEngine } from "../audio/audio-engine";
import type { AnalysisTarget } from "../audio/frame-protocol";
import { instrumentRegistry } from "./registry";
import {
  hasKnownMicGrant,
  hasOpenedInstallHint,
  hasOpenedControls,
  markControlsOpened,
  markInstallHintOpened,
  markMicGranted,
} from "./session";
import { applyAnalysisFrame, createInitialState, resetForPreset } from "./state";
import { getPresetById } from "../domain/tuning";
import { resolveStringTargetHz } from "../domain/instrument";
import { createControls } from "../ui/controls";
import { Renderer } from "../ui/renderer";
import { buildRenderState } from "../ui/scene";
import { requestWakeLock, releaseWakeLock } from "../pwa/wake-lock";
import { loadVersionInfo, registerServiceWorker } from "../pwa/version";

function buildGlassVeil(): HTMLDivElement {
  const veil = document.createElement("div");
  veil.className = "glass-veil";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mic-button";
  button.setAttribute("aria-label", "Enable microphone");
  const capsule = document.createElement("span");
  capsule.className = "mic-capsule";
  const stand = document.createElement("span");
  stand.className = "mic-stand";
  const base = document.createElement("span");
  base.className = "mic-base";
  button.append(capsule, stand, base);
  veil.appendChild(button);
  return veil;
}

function targetsForPreset(preset: ReturnType<typeof getPresetById>): AnalysisTarget[] {
  return preset.strings.map((stringDef) => ({ id: stringDef.id, hz: resolveStringTargetHz(stringDef) }));
}

type StartSource = "auto" | "user";

interface StartInFlight {
  promise: Promise<void>;
  source: StartSource;
}

export async function bootstrapApp(root: HTMLElement): Promise<void> {
  const version = await loadVersionInfo().catch(() => ({
    appVersion: "0.1.0",
    buildTime: new Date().toISOString(),
  }));
  await registerServiceWorker(version.appVersion);

  const instrument = instrumentRegistry.guitar;
  let preset = getPresetById(instrument.presets, instrument.defaultPresetId);
  let state = createInitialState(preset);

  const shell = document.createElement("div");
  shell.className = "app-shell";
  const canvas = document.createElement("canvas");
  canvas.className = "stage";
  const renderer = new Renderer(canvas);
  const controls = createControls({
    presets: instrument.presets,
    activePresetId: preset.id,
    installPulse: !hasOpenedInstallHint(),
    pulse: !hasOpenedControls(),
    onInstallOpenOnce() {
      markInstallHintOpened();
      controls.setInstallPulse(false);
    },
    onOpenOnce() {
      markControlsOpened();
      controls.setPulse(false);
    },
    onSelect(presetId) {
      preset = getPresetById(instrument.presets, presetId);
      state = resetForPreset(preset);
      controls.setActivePreset(presetId);
      controls.setPulse(false);
      const renderState = buildRenderState(state, preset, !hasOpenedControls(), performance.now());
      controls.setStringLabels(renderState.strings);
      renderer.setState(renderState);
      if (engine) engine.setTargets(targetsForPreset(preset));
    },
  });
  const glassVeil = buildGlassVeil();
  shell.append(canvas, controls.root, glassVeil);
  root.replaceChildren(shell);

  const engine = new AudioEngine(instrument, version);
  let audioWasLive = false;
  let resumeAfterVisibilityRestore = false;
  let lifecycleGeneration = 0;
  let activeStartToken = 0;
  let startInFlight: StartInFlight | null = null;
  engine.onFrame((frame) => {
    const nowMs = performance.now();
    applyAnalysisFrame(state, frame, preset, nowMs);
    const renderState = buildRenderState(state, preset, !hasOpenedControls(), nowMs);
    controls.setStringLabels(renderState.strings);
    renderer.setState(renderState);
  });

  const runStartAudio = async (token: number): Promise<void> => {
    const generation = lifecycleGeneration;
    try {
      await engine.start(targetsForPreset(preset));
      if (document.hidden || generation !== lifecycleGeneration || token !== activeStartToken) {
        if (token === activeStartToken) {
          await engine.stop();
          audioWasLive = false;
          glassVeil.hidden = false;
        }
        return;
      }
      if (!engine.isRunning()) {
        if (token === activeStartToken) {
          audioWasLive = false;
          glassVeil.hidden = false;
          await engine.stop();
        }
        return;
      }
      markMicGranted();
      audioWasLive = true;
      glassVeil.hidden = true;
      await requestWakeLock();
    } catch {
      if (token === activeStartToken) {
        audioWasLive = false;
        glassVeil.hidden = false;
        await engine.stop().catch(() => undefined);
      }
      // Keep the microphone prompt visible so the user can retry in-place.
    }
  };

  const startAudio = (source: StartSource): Promise<void> => {
    if (startInFlight) {
      if (source !== "user" || startInFlight.source !== "auto") {
        return startInFlight.promise;
      }
      lifecycleGeneration += 1;
      audioWasLive = false;
      glassVeil.hidden = false;
      void engine.stop();
    }
    const token = (activeStartToken += 1);
    const entry: StartInFlight = {
      source,
      promise: Promise.resolve(),
    };
    entry.promise = runStartAudio(token).finally(() => {
      if (startInFlight === entry) {
        startInFlight = null;
      }
    });
    startInFlight = entry;
    return entry.promise;
  };

  const micButton = glassVeil.querySelector("button");
  micButton?.addEventListener("pointerup", () => {
    void startAudio("user");
  });
  micButton?.addEventListener("click", () => {
    void startAudio("user");
  });

  if (hasKnownMicGrant()) {
    void startAudio("auto");
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      lifecycleGeneration += 1;
      resumeAfterVisibilityRestore = audioWasLive;
      audioWasLive = false;
      glassVeil.hidden = false;
      void releaseWakeLock();
      void engine.stop();
      return;
    }
    if (resumeAfterVisibilityRestore) {
      resumeAfterVisibilityRestore = false;
      void startAudio("auto");
    }
  });

  window.addEventListener("pagehide", () => {
    lifecycleGeneration += 1;
    audioWasLive = false;
    resumeAfterVisibilityRestore = false;
    void releaseWakeLock();
    void engine.stop();
  });

  window.addEventListener("beforeunload", () => {
    lifecycleGeneration += 1;
    void releaseWakeLock();
    void engine.stop();
  });

  const initialRenderState = buildRenderState(
    state,
    preset,
    !hasOpenedControls(),
    performance.now(),
  );
  controls.setStringLabels(initialRenderState.strings);
  renderer.setState(initialRenderState);
}
