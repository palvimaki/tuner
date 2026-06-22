export interface VersionInfo {
  appVersion: string;
  buildTime: string;
}

export async function loadVersionInfo(): Promise<VersionInfo> {
  const response = await fetch("/version.json", { cache: "no-store" });
  return response.json() as Promise<VersionInfo>;
}

export async function registerServiceWorker(appVersion: string): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register(`/sw.js?v=${appVersion}`, { scope: "/" });
  } catch {
    return;
  }
}

// After a deploy, skipWaiting+clients.claim activate the new service worker in
// already-open tabs. Reload once on that controller swap so the page picks up
// the new app code (not just the new cache). Skipped on first install, where no
// previous controller existed, to avoid a needless reload.
export function enableServiceWorkerAutoReload(): void {
  if (!("serviceWorker" in navigator)) return;
  if (!navigator.serviceWorker.controller) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}
