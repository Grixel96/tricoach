/* TriCoach Service Worker — App-Shell cache-first, data.json network-first */
const CACHE = "tricoach-v1";
const SHELL = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // data.json + plan.ics: network-first, fall back to cache
  if (url.pathname.endsWith("data.json") || url.pathname.endsWith("plan.ics")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // shell: cache-first
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
