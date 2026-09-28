/* PIXEL POCKET offline shell — cache the deck, cores, and cartridges already on this computer. */
const SHELL = "pixel-pocket-shell-v1";
const CORES = "pixel-pocket-cores-v1";

const PRECACHE = [
  "/",
  "/favicon.svg",
  "/desktop",
  "/login",
  "/images/hero.jpg",
  "/images/mascot.jpg",
  "/images/cartridge.jpg",
  "/images/console-nes.jpg",
  "/images/console-snes.jpg",
  "/images/console-gb.jpg",
  "/images/console-gba.jpg",
  "/images/console-nds.jpg",
  "/images/console-n64.jpg",
  "/images/console-ps1.jpg",
  "/images/desktop-win.jpg",
  "/images/desktop-mac.jpg",
  "/audio/error.mp3",
  "/audio/loaded.mp3",
  "/audio/poweron.mp3",
  "/audio/welcome.mp3",
  "/roms/astrohawk.smc",
  "/roms/blastah.gb",
  "/roms/croom.nes",
  "/roms/flappybird.nes",
  "/roms/frogtris.gba",
  "/roms/geometrix.gbc",
  "/roms/goodboyadvance.gba",
  "/roms/invaders.nes",
  "/roms/pong1k.nes",
  "/roms/rockfall.smc",
  "/roms/station-boot.exe",
];

const CORE_HOSTS = new Set([
  "cdn.emulatorjs.org",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "fastly.jsdelivr.net",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL && key !== CORES)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isViteNoise(url) {
  return (
    url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/src/") ||
    url.pathname.startsWith("/node_modules/") ||
    url.pathname.includes(".tsx") ||
    url.pathname.includes(".ts") ||
    url.searchParams.has("t")
  );
}

function isApi(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/__tsr");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (isViteNoise(url) || isApi(url)) return;

  if (CORE_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(req, CORES));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(networkFirst(req, SHELL, "/"));
    return;
  }

  if (
    url.pathname.startsWith("/images/") ||
    url.pathname.startsWith("/roms/") ||
    url.pathname.startsWith("/audio/") ||
    url.pathname.startsWith("/videos/") ||
    url.pathname === "/favicon.svg" ||
    url.pathname.startsWith("/__grok/")
  ) {
    event.respondWith(cacheFirst(req, SHELL));
    return;
  }

  event.respondWith(networkFirst(req, SHELL));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req, cacheName, fallback) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (fallback ? await cache.match(fallback) : null);
    if (hit) return hit;
    throw err;
  }
}
