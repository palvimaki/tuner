import { AudioEngine } from "../audio/audio-engine";
import type { AnalysisTarget } from "../audio/frame-protocol";
import { instrumentRegistry } from "./registry";
import { isStandaloneMode, openBrowserEscape } from "./routing";
import {
  hasKnownMicGrant,
  hasOpenedControls,
  markControlsOpened,
  markMicGranted,
} from "./session";
import { applyAnalysisFrame, createInitialState, resetForPreset } from "./state";
import { getPresetById } from "../domain/tuning";
import { createControls } from "../ui/controls";
import { createFallbackGlyph } from "../ui/fallback-glyph";
import { Renderer } from "../ui/renderer";
import { buildRenderState } from "../ui/scene";
import { requestWakeLock, releaseWakeLock } from "../pwa/wake-lock";
import { loadVersionInfo, registerServiceWorker } from "../pwa/version";

function buildGlassVeil(): HTMLDivElement {
  const veil = document.createElement("div");
  veil.className = "glass-veil";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "glass-button";
  button.setAttribute("aria-label", "Enable microphone");
  veil.appendChild(button);
  return veil;
}

function targetsForPreset(preset: ReturnType<typeof getPresetById>): AnalysisTarget[] {
  return preset.strings.map((stringDef) => ({ id: stringDef.id, hz: stringDef.hz }));
}

export async function bootstrapApp(root: HTMLElement): Promise<void> {
  const version = await loadVersionInfo().catch(() => ({
    appVersion: "0.1.0",
    samplesVersion: "1",
    buildTime: new Date().toISOString(),
  }));
  await registerServiceWorker(version.appVersion);

  const instrument = instrumentRegistry.guitar;
  let preset = getPresetById(instrument.presets, instrument.defaultPresetId);
  let state = createInitialState(preset);
  const standalone = isStandaloneMode();

  const shell = document.createElement("div");
  shell.className = "app-shell";
  const canvas = document.createElement("canvas");
  canvas.className = "stage";
  const renderer = new Renderer(canvas);
  const controls = createControls({
    presets: instrument.presets,
    activePresetId: preset.id,
    pulse: !hasOpenedControls(),
    onOpenOnce() {
      markControlsOpened();
      controls.setPulse(false);
    },
    onSelect(presetId) {
      preset = getPresetById(instrument.presets, presetId);
      state = resetForPreset(preset);
      controls.setActivePreset(presetId);
      controls.setPulse(false);
      const renderState = buildRenderState(
        state,
        preset,
        !fallback.hidden,
        !hasOpenedControls(),
        performance.now(),
      );
      controls.setStringLabels(renderState.strings);
      renderer.setState(renderState);
      if (engine) engine.setTargets(targetsForPreset(preset));
    },
  });
  const glassVeil = buildGlassVeil();
  const fallback = createFallbackGlyph(() => openBrowserEscape());
  fallback.hidden = true;
  shell.append(canvas, controls.root, glassVeil, fallback);
  root.replaceChildren(shell);

  const engine = new AudioEngine(instrument, version);
  engine.onFrame((frame) => {
    const nowMs = performance.now();
    const effects = applyAnalysisFrame(state, frame, preset, nowMs);
    if (effects.lockedStringId) {
      engine.playLockPing();
    }
    if (effects.completed) {
      engine.playCompletionStrum(preset);
    }
    const renderState = buildRenderState(state, preset, !fallback.hidden, !hasOpenedControls(), nowMs);
    controls.setStringLabels(renderState.strings);
    renderer.setState(renderState);
  });

  const startAudio = async (): Promise<void> => {
    fallback.hidden = true;
    try {
      await engine.start(targetsForPreset(preset));
      markMicGranted();
      const ok = await engine.waitForLiveInput({
        timeoutMs: 1500,
        minLiveFrames: 12,
        minVariance: 1e-7,
      });
      if (!ok && standalone) {
        fallback.hidden = false;
      } else {
        glassVeil.hidden = true;
        await requestWakeLock();
      }
    } catch {
      if (standalone) {
        fallback.hidden = false;
      }
    }
  };

  glassVeil.querySelector("button")?.addEventListener("click", () => {
    void startAudio();
  });

  if (hasKnownMicGrant()) {
    void startAudio();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (state.activeStringId) {
      engine.playReference(state.activeStringId);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.max(0, Math.min(preset.strings.length - 1, Math.round(ratio * (preset.strings.length - 1))));
    engine.playReference(preset.strings[index]?.id ?? preset.strings[0].id);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      void releaseWakeLock();
      void engine.suspend();
      return;
    }
    void engine.resume().then(() => requestWakeLock());
  });

  const initialRenderState = buildRenderState(
    state,
    preset,
    false,
    !hasOpenedControls(),
    performance.now(),
  );
  controls.setStringLabels(initialRenderState.strings);
  renderer.setState(initialRenderState);
}
