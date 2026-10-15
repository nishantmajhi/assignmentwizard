const CACHE_NAME = "assignmentwizard-v4";

// How long to wait for the network before answering from the cache instead,
// when there is a cached copy to answer with.
const NETWORK_TIMEOUT_MS = 3000;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/app.js",
  "./js/state.js",
  "./js/utils.js",
  "./js/confirm-dialog.js",
  "./js/stepper.js",
  "./js/project-picker.js",
  "./js/prompts.js",
  "./js/phases/phase0-setup.js",
  "./js/phases/phase1-extraction.js",
  "./js/phases/phase2-preferences.js",
  "./js/phases/phase3-drafting.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  // "reload" skips the browser's HTTP cache, so a new worker caches the files
  // that are deployed now rather than copies the browser already held.
  const requests = APP_SHELL.map((url) => new Request(url, { cache: "reload" }));
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(requests))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// The app's own files are network-first: a deploy reaches the next page load
// with no CACHE_NAME bump, and the cache is what answers offline. The Google
// Fonts files are versioned by URL, so those stay cache-first.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    const network = fetch(request);
    // Registered now, not when the response arrives: by then the timeout may
    // have answered from the cache, and a late waitUntil throws.
    event.waitUntil(keepCopy(request, network, (response) => response.ok));
    event.respondWith(networkFirst(request, network));
  } else if (url.protocol === "https:") {
    event.respondWith(cacheFirst(event));
  }
});

// Store the response for next time, if keep() says it is worth keeping.
// Called before anything else reads the response, so the clone is intact.
function keepCopy(request, network, keep) {
  return network
    .then((response) => {
      if (!keep(response)) return undefined;
      const copy = response.clone();
      return caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    })
    .catch(() => {});
}

function networkFirst(request, network) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (response) => {
      if (!answered) {
        answered = true;
        resolve(response);
      }
    };

    const timer = setTimeout(() => {
      caches.match(request).then((cached) => {
        if (cached) answer(cached);
      });
    }, NETWORK_TIMEOUT_MS);

    network.then(
      (response) => {
        clearTimeout(timer);
        answer(response);
      },
      () => {
        clearTimeout(timer);
        fromCache(request).then(answer);
      }
    );
  });
}

// Offline: the cached copy, or for a page load the app itself -- a link with
// a query string on it has no exact entry in the cache -- or a network error.
function fromCache(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    if (request.mode === "navigate") {
      return caches.match("./index.html").then((page) => page || Response.error());
    }
    return Response.error();
  });
}

function cacheFirst(event) {
  const { request } = event;
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    const network = fetch(request);
    // A font stylesheet requested without CORS comes back opaque, and its
    // status cannot be read; keep it, as the original did.
    event.waitUntil(keepCopy(request, network, (response) => response.ok || response.type === "opaque"));
    return network;
  });
}
