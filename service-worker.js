const APP_CACHE = 'chessfen-app-v6';
const LIB_CACHE = 'chessfen-libs-v6';
const MODEL_CACHE = 'chessfen-model-v6';

const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './board-detect.js',
  './piece-detector.js',
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
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort-wasm-simd-threaded.wasm',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort-wasm-simd-threaded.mjs'
];

// Modello di riconoscimento pezzi: file grande e immutabile, si scarica
// una sola volta e poi si serve sempre dalla cache (mai dalla rete).
const MODEL_FILES = [
  './model/yolo26n-chess.onnx'
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
