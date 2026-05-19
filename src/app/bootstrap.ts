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
  let startInFlight: Promise<void> | null = null;
  engine.onFrame((frame) => {
    const nowMs = performance.now();
    applyAnalysisFrame(state, frame, preset, nowMs);
    const renderState = buildRenderState(state, preset, !hasOpenedControls(), nowMs);
    controls.setStringLabels(renderState.strings);
    renderer.setState(renderState);
  });

  const runStartAudio = async (): Promise<void> => {
    const generation = lifecycleGeneration;
    try {
      await engine.start(targetsForPreset(preset));
      if (document.hidden || generation !== lifecycleGeneration) {
        await engine.stop();
        audioWasLive = false;
        glassVeil.hidden = false;
        return;
      }
      markMicGranted();
      const ok = await engine.waitForLiveInput({
        timeoutMs: 1500,
        minLiveFrames: 12,
        minVariance: 1e-7,
      });
      if (ok) {
        audioWasLive = true;
        glassVeil.hidden = true;
        await requestWakeLock();
      } else {
        audioWasLive = false;
        glassVeil.hidden = false;
      }
    } catch {
      audioWasLive = false;
      glassVeil.hidden = false;
      // Keep the microphone prompt visible so the user can retry in-place.
    }
  };

  const startAudio = (): Promise<void> => {
    if (!startInFlight) {
      startInFlight = runStartAudio().finally(() => {
        startInFlight = null;
      });
    }
    return startInFlight;
  };

  glassVeil.querySelector("button")?.addEventListener("click", () => {
    void startAudio();
  });

  if (hasKnownMicGrant()) {
    void startAudio();
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
      void startAudio();
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
