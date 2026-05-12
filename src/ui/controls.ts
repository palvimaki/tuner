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
  pulse: boolean;
  onSelect(presetId: string): void;
  onOpenOnce?(): void;
}

export interface ControlsHandle {
  root: HTMLDivElement;
  setPulse(active: boolean): void;
  setActivePreset(presetId: string): void;
  setStringLabels(strings: readonly RenderString[]): void;
}

export function createControls(options: ControlsOptions): ControlsHandle {
  const root = document.createElement("div");
  root.className = "hud";

  const brand = document.createElement("div");
  brand.className = "brand-mark";
  brand.setAttribute("aria-label", "tuner.fi");
  brand.setAttribute("role", "img");
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
    if (!panel.hidden && !openedOnce) {
      openedOnce = true;
      options.onOpenOnce?.();
    }
  });

  root.append(labelRail, brand, toggle, panel);

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
