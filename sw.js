// アプリの見た目部分だけをキャッシュする。データと写真はSupabaseから毎回取得する。
const CACHE = 'gohan-v19';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './supabase.js',
  './image.js',
  './ingredients.js',
  './places.js',
  './chat.js',
  './points.js',
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './images/aquarium-bg.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // reload: 初回の取り込みでも必ずサーバーの最新を入れる
      .then((cache) => cache.addAll(ASSETS.map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Supabaseへの通信やPOSTには一切手を出さない
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // ネットワーク優先。こうしておくと、アプリを更新したとき古い画面が残らない。
  // 圏外のときだけキャッシュを使う。
  //
  // cache: 'reload' が要。これがないと、ここでの fetch がブラウザのHTTPキャッシュに
  // 当たってしまい、GitHub Pagesのキャッシュ指示（最大10分）のあいだ
  // 更新が届かない。毎回サーバーに問い合わせて最新を取りに行く。
  event.respondWith(
    fetch(new Request(event.request, { cache: 'reload' }))
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match('./index.html')))
  );
});
