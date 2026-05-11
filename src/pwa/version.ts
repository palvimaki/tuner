export interface VersionInfo {
  appVersion: string;
  samplesVersion: string;
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
