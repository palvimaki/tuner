import type { TuningPreset } from "../domain/instrument";

function presetGlyph(preset: TuningPreset): string {
  const baseMidi = preset.strings[0]?.midi ?? 0;
  return preset.strings
    .map((stringDef) => `<span style="height:${10 + (stringDef.midi - baseMidi) * 1.5}px"></span>`)
    .join("");
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
}

export function createControls(options: ControlsOptions): ControlsHandle {
  const root = document.createElement("div");
  root.className = "hud";

  const brand = document.createElement("div");
  brand.className = "brand-mark";
  brand.setAttribute("aria-hidden", "true");

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
    button.innerHTML = `<span class="preset-lines">${presetGlyph(preset)}</span>`;
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

  root.append(brand, toggle, panel);

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
  };
}
