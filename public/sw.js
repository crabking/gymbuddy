const SW_VERSION = new URL(self.location.href).searchParams.get("v") || "development";
const CACHE_NAME = `coach-shell-${SW_VERSION}`;
const PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest?v=tank-gorilla-20260725",
  "/icons/app-icon-gorilla-180.png?v=tank-gorilla-20260725",
  "/icons/app-icon-gorilla-192.png?v=tank-gorilla-20260725",
  "/icons/app-icon-gorilla-512.png?v=tank-gorilla-20260725",
  "/icons/app-icon-gorilla-maskable-512.png?v=tank-gorilla-20260725",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("coach-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match("/offline.html");
        return cached ?? Response.error();
      }),
    );
  }
});
