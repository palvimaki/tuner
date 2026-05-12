export const FIRST_OPEN_KEY = "tuner:tuning-selector-opened";
export const MIC_GRANTED_KEY = "tuner:mic-granted";
export const INSTALL_OPEN_KEY = "tuner:install-panel-opened";

export function hasOpenedControls(): boolean {
  return localStorage.getItem(FIRST_OPEN_KEY) === "1";
}

export function markControlsOpened(): void {
  localStorage.setItem(FIRST_OPEN_KEY, "1");
}

export function hasOpenedInstallHint(): boolean {
  return localStorage.getItem(INSTALL_OPEN_KEY) === "1";
}

export function markInstallHintOpened(): void {
  localStorage.setItem(INSTALL_OPEN_KEY, "1");
}

export function hasKnownMicGrant(): boolean {
  return localStorage.getItem(MIC_GRANTED_KEY) === "1";
}

export function markMicGranted(): void {
  localStorage.setItem(MIC_GRANTED_KEY, "1");
}
