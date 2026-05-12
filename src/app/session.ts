export const FIRST_OPEN_KEY = "tuner:first-opened";
export const MIC_GRANTED_KEY = "tuner:mic-granted";
export const INSTALL_HINT_DISMISSED_KEY = "tuner:install-hint-dismissed";

export function hasOpenedControls(): boolean {
  return localStorage.getItem(FIRST_OPEN_KEY) === "1";
}

export function markControlsOpened(): void {
  localStorage.setItem(FIRST_OPEN_KEY, "1");
}

export function hasDismissedInstallHint(): boolean {
  return localStorage.getItem(INSTALL_HINT_DISMISSED_KEY) === "1";
}

export function markInstallHintDismissed(): void {
  localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, "1");
}

export function hasKnownMicGrant(): boolean {
  return localStorage.getItem(MIC_GRANTED_KEY) === "1";
}

export function markMicGranted(): void {
  localStorage.setItem(MIC_GRANTED_KEY, "1");
}
