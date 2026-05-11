export function isStandaloneMode(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    ((navigator as Navigator & { standalone?: boolean }).standalone ?? false) === true
  );
}

export function getShellPathMode(): "browser" | "installed" {
  return window.location.pathname.startsWith("/app/") ? "installed" : "browser";
}

export function openBrowserEscape(): void {
  window.location.href = "/";
  window.setTimeout(() => {
    window.open("/", "_blank", "noopener,noreferrer");
  }, 120);
}
