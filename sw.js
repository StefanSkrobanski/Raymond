// Service worker: network first, cache as fallback.
//
// GitHub Pages lets browsers cache each file for up to 10 minutes, and the
// page loads many separate modules, so after an update a browser could mix
// new files with stale cached ones and break. Fetching every file from the
// network (bypassing the HTTP cache) keeps them all from the same version.
// Each response is also saved, so the app still opens offline, for example
// from a phone's home screen. Ported from Styx.

const CACHE = "raymond";

self.addEventListener("install", () => {
    // Take over from an older worker straight away.
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    // Control pages that are already open, not just ones opened later.
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {

    const request = event.request;

    // Only handle this site's own files.
    if (request.method != "GET" || new URL(request.url).origin != self.location.origin) {
        return;
    }

    event.respondWith(networkFirst(request));
});

async function networkFirst(request) {

    try {
        // "no-cache" revalidates with the server instead of trusting the
        // browser's cached copy; unchanged files come back as a cheap 304.
        const response = await fetch(request, { cache: "no-cache" });

        if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(request, response.clone());
        }

        return response;
    }
    catch (error) {
        // Offline: fall back to the last copy saved.
        const cached = await caches.match(request);

        if (cached !== undefined) {
            return cached;
        }

        throw error;
    }
}
