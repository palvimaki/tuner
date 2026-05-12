import type { TuningPreset } from "../domain/instrument";
import type { RenderString } from "./scene";

function presetGlyph(preset: TuningPreset): HTMLSpanElement {
  const midis = preset.strings.map((stringDef) => stringDef.midi);
  const minMidi = Math.min(...midis);
  const maxMidi = Math.max(...midis);
  const span = Math.max(1, maxMidi - minMidi);
  const lines = document.createElement("span");
  lines.className = "preset-lines";

  preset.strings.forEach((stringDef) => {
    const line = document.createElement("span");
    line.className = "preset-line";
    const heightPx = 6 + ((stringDef.midi - minMidi) / span) * 14;
    line.style.setProperty("--preset-line-h", `${heightPx}px`);
    lines.appendChild(line);
  });

  return lines;
}

export interface ControlsOptions {
  presets: readonly TuningPreset[];
  activePresetId: string;
  installPulse: boolean;
  pulse: boolean;
  onInstallOpenOnce?(): void;
  onSelect(presetId: string): void;
  onOpenOnce?(): void;
}

export interface ControlsHandle {
  root: HTMLDivElement;
  setInstallPulse(active: boolean): void;
  setPulse(active: boolean): void;
  setActivePreset(presetId: string): void;
  setStringLabels(strings: readonly RenderString[]): void;
}

export function createControls(options: ControlsOptions): ControlsHandle {
  const root = document.createElement("div");
  root.className = "hud";

  const brand = document.createElement("button");
  brand.type = "button";
  brand.className = "brand-mark";
  brand.setAttribute("aria-label", "tuner.fi");
  brand.setAttribute("aria-haspopup", "dialog");
  brand.setAttribute("aria-expanded", "false");
  brand.setAttribute("aria-controls", "install-panel");
  if (options.installPulse) brand.dataset.pulse = "1";
  const brandText = document.createElement("span");
  brandText.className = "brand-mark-text";
  brandText.textContent = "t";
  brand.appendChild(brandText);

  const labelRail = document.createElement("div");
  labelRail.className = "string-labels";
  const labels = new Map<string, HTMLSpanElement>();

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "picker-toggle";
  toggle.setAttribute("aria-label", "Tunings");
  if (options.pulse) toggle.dataset.pulse = "1";

  const panel = document.createElement("div");
  panel.className = "preset-panel";
  panel.hidden = true;
  let openedOnce = false;

  const installPanel = document.createElement("div");
  installPanel.className = "install-panel";
  installPanel.id = "install-panel";
  installPanel.setAttribute("role", "dialog");
  installPanel.setAttribute("aria-labelledby", "install-panel-title");
  installPanel.hidden = true;
  let installOpenedOnce = !options.installPulse;

  const installHeader = document.createElement("div");
  installHeader.className = "install-header";
  const installTitle = document.createElement("h2");
  installTitle.className = "install-title";
  installTitle.id = "install-panel-title";
  installTitle.textContent = "Install tuner.fi";
  const closeInstall = document.createElement("button");
  closeInstall.type = "button";
  closeInstall.className = "install-close";
  closeInstall.setAttribute("aria-label", "Close install instructions");
  closeInstall.textContent = "x";
  installHeader.append(installTitle, closeInstall);

  const installLead = document.createElement("p");
  installLead.className = "install-lead";
  installLead.textContent = "Add tuner.fi to your home screen for offline tuning and full app experience.";

  const iphoneStep = document.createElement("section");
  iphoneStep.className = "install-step";
  const iphoneTitle = document.createElement("h3");
  iphoneTitle.textContent = "iPhone / Safari";
  const iphoneCopy = document.createElement("p");
  iphoneCopy.innerHTML =
    "Open tuner.fi in Safari. Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Make sure <strong>Open as Web App</strong> is switched on, then tap <strong>Add</strong>.";
  iphoneStep.append(iphoneTitle, iphoneCopy);

  const androidStep = document.createElement("section");
  androidStep.className = "install-step";
  const androidTitle = document.createElement("h3");
  androidTitle.textContent = "Android / Chrome";
  const androidCopy = document.createElement("p");
  androidCopy.innerHTML =
    "Tap Chrome's menu, then <strong>Install app</strong> (or <strong>Add to Home screen</strong>). Choose <strong>Install</strong> - this opens tuner.fi as a proper web app, not a shortcut.";
  androidStep.append(androidTitle, androidCopy);

  installPanel.append(installHeader, installLead, iphoneStep, androidStep);

  const buttons = new Map<string, HTMLButtonElement>();

  options.presets.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-button";
    button.setAttribute("aria-label", preset.name);
    button.dataset.presetId = preset.id;
    if (preset.id === options.activePresetId) button.dataset.active = "1";
    button.appendChild(presetGlyph(preset));
    const name = document.createElement("span");
    name.className = "preset-name";
    name.textContent = preset.name;
    button.appendChild(name);
    button.addEventListener("click", () => {
      options.onSelect(preset.id);
      panel.hidden = true;
    });
    panel.appendChild(button);
    buttons.set(preset.id, button);
  });

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      installPanel.hidden = true;
      brand.setAttribute("aria-expanded", "false");
    }
    if (!panel.hidden && !openedOnce) {
      openedOnce = true;
      options.onOpenOnce?.();
    }
  });

  const dismissInstallPanel = (): void => {
    installPanel.hidden = true;
    brand.setAttribute("aria-expanded", "false");
  };

  brand.addEventListener("click", () => {
    if (!installPanel.hidden) {
      dismissInstallPanel();
      return;
    }
    installPanel.hidden = false;
    brand.setAttribute("aria-expanded", "true");
    panel.hidden = true;
    if (!installOpenedOnce) {
      installOpenedOnce = true;
      options.onInstallOpenOnce?.();
    }
  });

  closeInstall.addEventListener("click", () => {
    dismissInstallPanel();
    brand.focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !installPanel.hidden) {
      dismissInstallPanel();
      brand.focus();
    }
  });

  root.append(labelRail, brand, toggle, panel, installPanel);

  const syncLabelRail = (strings: readonly RenderString[]): void => {
    const nextIds = strings.map((stringState) => stringState.id);
    const currentIds = Array.from(labels.keys());
    const needsRebuild =
      nextIds.length !== currentIds.length || nextIds.some((id, index) => id !== currentIds[index]);

    if (needsRebuild) {
      labelRail.replaceChildren();
      labels.clear();
      strings.forEach((stringState) => {
        const label = document.createElement("span");
        label.className = "string-label";
        label.textContent = stringState.label;
        labelRail.appendChild(label);
        labels.set(stringState.id, label);
      });
    }

    strings.forEach((stringState) => {
      const label = labels.get(stringState.id);
      if (!label) return;
      label.textContent = stringState.label;
      if (stringState.active) label.dataset.active = "1";
      else delete label.dataset.active;
      if (stringState.inTune) label.dataset.inTune = "1";
      else delete label.dataset.inTune;
      if (stringState.locked) label.dataset.locked = "1";
      else delete label.dataset.locked;
    });
  };

  return {
    root,
    setInstallPulse(active) {
      if (active) brand.dataset.pulse = "1";
      else delete brand.dataset.pulse;
    },
    setPulse(active) {
      if (active) toggle.dataset.pulse = "1";
      else delete toggle.dataset.pulse;
    },
    setActivePreset(presetId) {
      buttons.forEach((button, id) => {
        if (id === presetId) button.dataset.active = "1";
        else delete button.dataset.active;
      });
    },
    setStringLabels(strings) {
      syncLabelRail(strings);
    },
  };
}
