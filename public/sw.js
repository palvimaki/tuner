const VERSION = "__APP_VERSION__";
const SAMPLES_VERSION = "__SAMPLES_VERSION__";
const SHELL_CACHE = `tuner-shell-${VERSION}`;
const AUDIO_CACHE = `tuner-audio-${SAMPLES_VERSION}`;
const SHELL_ASSETS = __SHELL_ASSETS__;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== AUDIO_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  if (url.pathname.startsWith("/audio/")) {
    event.respondWith(cacheFirst(request, AUDIO_CACHE));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/worklets/")) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match(request.url.endsWith("/app/") ? "/app/" : "/"))
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}
