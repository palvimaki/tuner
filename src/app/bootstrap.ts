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
import { enableServiceWorkerAutoReload, loadVersionInfo, registerServiceWorker } from "../pwa/version";
import type { RenderState } from "../ui/scene";

function buildGlassVeil(): HTMLDivElement {
  const veil = document.createElement("div");
  veil.className = "glass-veil";
  const panel = document.createElement("div");
  panel.className = "mic-activation";
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
  const label = document.createElement("span");
  label.className = "mic-button-label";
  label.textContent = "Enable microphone";
  button.append(capsule, stand, base, label);
  const recovery = document.createElement("p");
  recovery.className = "mic-recovery";
  recovery.hidden = true;
  recovery.setAttribute("role", "status");
  recovery.setAttribute("aria-live", "polite");
  recovery.setAttribute("aria-atomic", "true");
  panel.append(button, recovery);
  veil.appendChild(panel);
  return veil;
}

function micRecoveryMessage(error: unknown): string {
  const name = typeof error === "object" && error !== null && "name" in error
    ? String(error.name)
    : "";
  if (name === "NotAllowedError") {
    return "Allow microphone access in your browser settings. Then tap Try again.";
  }
  if (name === "NotFoundError") {
    return "No microphone is available. Connect one, then tap Try again.";
  }
  if (name === "NotReadableError") {
    return "Your microphone is busy. Close other apps, then tap Try again.";
  }
  if (name === "NotSupportedError") {
    return "This browser does not support microphone access. Use a supported browser, then tap Try again.";
  }
  return "The microphone did not start. Check browser settings, then tap Try again.";
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
  // Register off the critical first-paint path, and reload long-lived tabs when
  // a freshly-activated service worker takes over (see pwa/version.ts).
  enableServiceWorkerAutoReload();
  void registerServiceWorker(version.appVersion);

  const instrument = instrumentRegistry.guitar;
  let preset = getPresetById(instrument.presets, instrument.defaultPresetId);
  let state = createInitialState(preset);

  // The tuner readout is drawn on <canvas>, which screen readers cannot see.
  // Mirror the active-string / in-tune / completion state into a polite live
  // region so the same information is announced audibly. Only re-announces when
  // the meaningful state changes, to avoid flooding the reader every frame.
  const ariaLive = document.createElement("div");
  ariaLive.className = "sr-only";
  ariaLive.setAttribute("role", "status");
  ariaLive.setAttribute("aria-live", "polite");
  ariaLive.setAttribute("aria-atomic", "true");
  let lastAnnouncement = "";
  const announce = (renderState: RenderState): void => {
    let text = "";
    if (renderState.mode === "completed") {
      text = "All strings tuned.";
    } else {
      const active = renderState.strings.find((stringState) => stringState.active);
      if (active) {
        text = active.inTune ? `${active.label}, in tune` : active.label;
      }
    }
    // Update on every change — including the empty state when no string is
    // active — so clearing the active string resets the announcement and a
    // later re-pluck of the same string re-announces instead of being skipped.
    if (text !== lastAnnouncement) {
      lastAnnouncement = text;
      ariaLive.textContent = text;
    }
  };

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
      announce(renderState);
      if (engine) engine.setTargets(targetsForPreset(preset));
    },
  });
  const glassVeil = buildGlassVeil();
  shell.append(canvas, controls.root, glassVeil, ariaLive);
  root.replaceChildren(shell);

  const engine = new AudioEngine(instrument, version);
  const micButton = glassVeil.querySelector<HTMLButtonElement>("button");
  const micButtonLabel = glassVeil.querySelector<HTMLSpanElement>(".mic-button-label");
  const micRecovery = glassVeil.querySelector<HTMLParagraphElement>(".mic-recovery");
  const clearRecovery = (): void => {
    micRecovery!.hidden = true;
    micRecovery!.textContent = "";
    micButton!.setAttribute("aria-label", "Enable microphone");
    micButtonLabel!.textContent = "Enable microphone";
  };
  const showRecovery = (error: unknown): void => {
    micRecovery!.hidden = false;
    micRecovery!.textContent = micRecoveryMessage(error);
    micButton!.setAttribute("aria-label", "Try again");
    micButtonLabel!.textContent = "Try again";
  };
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
    announce(renderState);
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
      clearRecovery();
      glassVeil.hidden = true;
      await requestWakeLock();
    } catch (error) {
      if (token === activeStartToken) {
        audioWasLive = false;
        glassVeil.hidden = false;
        showRecovery(error);
        await engine.stop().catch(() => undefined);
      }
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

  let skipNextPointerClick = false;
  micButton?.addEventListener("pointerup", () => {
    skipNextPointerClick = true;
    window.setTimeout(() => {
      skipNextPointerClick = false;
    }, 0);
    void startAudio("user");
  });
  micButton?.addEventListener("click", () => {
    if (skipNextPointerClick) {
      skipNextPointerClick = false;
      return;
    }
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
  announce(initialRenderState);
}
