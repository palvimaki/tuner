import type { TuningPreset } from "./instrument";

export function getPresetById(
  presets: readonly TuningPreset[],
  presetId: string,
): TuningPreset {
  const preset = presets.find((entry) => entry.id === presetId);
  if (!preset) {
    throw new Error(`Unknown preset: ${presetId}`);
  }
  return preset;
}
