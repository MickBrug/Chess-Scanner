const APP_CACHE = 'chessfen-app-v4';
const LIB_CACHE = 'chessfen-libs-v4';
const MODEL_CACHE = 'chessfen-model-v4';

const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './board-detect.js',
  './piece-classifier.js',
  './sw-stockfish.js',
  './manifest.json',
  './icon.svg'
];

const LIB_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js',
  'https://cdn.jsdelivr.net/npm/@chrisoakman/chessboardjs@1.0.0/dist/chessboard-1.0.0.min.js',
  'https://cdn.jsdelivr.net/npm/@chrisoakman/chessboardjs@1.0.0/dist/chessboard-1.0.0.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@0.12.5'
];

// Modello di riconoscimento pezzi: file grandi e immutabili, si scaricano
// una sola volta e poi si servono sempre dalla cache (mai dalla rete).
const MODEL_FILES = [
  './model/tensorflowjs_model.pb',
  './model/weights_manifest.json',
  './model/group1-shard1of5',
  './model/group1-shard2of5',
  './model/group1-shard3of5',
  './model/group1-shard4of5',
  './model/group1-shard5of5'
];

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(APP_CACHE).then(c => Promise.all(APP_FILES.map(u => c.add(u).catch(() => {})))),
      caches.open(LIB_CACHE).then(c => Promise.all(LIB_FILES.map(u => c.add(u).catch(() => {})))),
      caches.open(MODEL_CACHE).then(c => Promise.all(MODEL_FILES.map(u => c.add(u).catch(() => {}))))
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== APP_CACHE && k !== LIB_CACHE && k !== MODEL_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isModelFile = isSameOrigin && url.pathname.includes('/model/');

  if (isModelFile) {
    event.respondWith(cacheFirst(event.request, MODEL_CACHE));
  } else if (isSameOrigin) {
    event.respondWith(networkFirst(event.request));
  } else {
    event.respondWith(cacheFirst(event.request, LIB_CACHE));
  }
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.status === 200) {
      const cache = await caches.open(APP_CACHE);
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.status === 200) {
    const cache = await caches.open(cacheName);
    cache.put(request, fresh.clone()).catch(() => {});
  }
  return fresh;
}
