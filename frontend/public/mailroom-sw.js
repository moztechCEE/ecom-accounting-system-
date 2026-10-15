/* Only immutable public shell assets belong in this cache. No application data. */
const CACHE_PREFIX = 'corely-mailroom-public-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_URL = '/mailroom-offline.html';
const PUBLIC_ASSETS = new Map([
  ['/mailroom.webmanifest', '33ebc1b69242daf480ff644e8ca68375f02edd638d21cd6e4834cdfca1162335'],
  [OFFLINE_URL, 'a6f6052b4a72d4f4861e5e664d347a9157681284620d0a1aa0694cf36d0eed1f'],
  ['/brand/mailroom-icon.svg', '34f1db5982079e2b8e83d9edfd6c3095910129069496168bd33da84ff8fb267a'],
  ['/brand/mailroom-icon-192.png', 'f159e27ee3ffed243b314944fbdfca5e78476c253c4e37677935d8b253fff4ac'],
  ['/brand/mailroom-icon-512.png', '3417541589d0a1bac99c8cfd48000946a17bf38e0bbd5dbb9c558c5f2ca364de'],
]);
const NAVIGATION_PATHS = new Set(['/operations/mailroom', '/operations/repair']);

async function publicAsset(path) {
  const url = new URL(path, self.location.origin);
  const response = await fetch(new Request(url.href, {
    credentials: 'omit', cache: 'reload', redirect: 'error',
  }));
  if (!response.ok || response.redirected || response.url !== url.href) {
    throw new Error('Public mailroom shell asset unavailable');
  }
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength > 1024 * 1024) throw new Error('Public mailroom shell asset too large');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== PUBLIC_ASSETS.get(path)) throw new Error('Public mailroom shell asset mismatch');
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const assets = await Promise.all([...PUBLIC_ASSETS.keys()].map(async path => [path, await publicAsset(path)]));
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(assets.map(([path, response]) => cache.put(new URL(path, self.location.origin).href, response)));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.search && PUBLIC_ASSETS.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(url.href) || await publicAsset(url.pathname);
    })());
    return;
  }
  if (request.mode !== 'navigate' || !NAVIGATION_PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    try {
      return await fetch(new Request(request, { cache: 'no-store' }));
    } catch {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(new URL(OFFLINE_URL, self.location.origin).href) ||
        new Response('目前無法連線，請連線後再開啟收發室工作台。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
    }
  })());
});
