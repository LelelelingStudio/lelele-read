/* =========================================================
   lelele-read Service Worker
   v6 (规则页细化与版权说明之后)
   静态资源：stale-while-revalidate（命中即秒开，后台更新）
   数据 JSON：network-first + 1.5s 超时快速回退缓存
   外部域一律直通（作者总表、统计、Supabase 等）
   ========================================================= */
const CACHE_NAME = 'lelele-read-v6';

const PRECACHE_ASSETS = [
    '/', '/index.html', '/reader.html', '/dashboard.html', '/login.html', '/docs.html',
    '/author.html', '/about.html', '/rules.html', '/privacy.html', '/copyright.html', '/404.html',
    '/common.css', '/common.js', '/common-ui.css', '/common-ui.js',
    '/reader.css', '/reader.js', '/reader-plus.css', '/reader-plus.js',
    '/window.css', '/window.js', '/doc.css', '/doc.js',
    '/other.css', '/other.js', '/epub-bridge.css', '/epub-bridge.js',
    '/user-api.js', '/user-auth.js', '/jszip.min.js',
    '/rank-plus.js', '/shelf-plus.js', '/home-nav.css', '/home-nav.js',
    '/notice.css', '/notice.js', '/winter.css', '/winter.js',
    '/bible.html', '/bible.css', '/bible.js', '/bible-tools.js',
    '/data/bible/books.json',
    '/activity.css', '/activity.js', '/activity.json',
    '/announcements.json', '/changelog.json',
    '/manifest-zh.json', '/manifest-en.json',
    '/leleleread.svg', '/favicon.ico', '/icon-192.png', '/icon-512.png',
    '/winter-bg-read.png', '/winter-snowman-read.png', '/winter-tree-read.png',
    '/winter-banner-read.png', '/winter-logo-read.png',
    '/data/books.json', '/data/community/books.json',
    '/data/bible/config.json', '/data/shijing/config.json', '/data/tree_zhou/config.json'
];

const DATA_PATH_RE = /(?:\/|^)(books\.json|config\.json|activity\.json|announcements\.json|changelog\.json|manifest-(?:zh|en)\.json|chapters\/[^/]+\.json)$/;

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.allSettled(PRECACHE_ASSETS.map(u => cache.add(u).catch(() => {})))
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

function isBasicOk(res) { return res && res.status === 200 && res.type === 'basic'; }

async function staleWhileRevalidate(event) {
    const req = event.request;
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const network = fetch(req).then(res => {
        if (isBasicOk(res)) cache.put(req, res.clone()).catch(() => {});
        return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    const fresh = await network;
    if (fresh) return fresh;
    if (req.mode === 'navigate') return (await cache.match('/index.html')) || Response.error();
    return Response.error();
}

async function networkFirstWithTimeout(req, ms) {
    const cache = await caches.open(CACHE_NAME);
    const ctrl = new AbortController();
    let timer;
    try {
        const timed = new Promise((_, reject) => {
            timer = setTimeout(() => { ctrl.abort(); reject(new Error('sw timeout')); }, ms);
        });
        const res = await Promise.race([fetch(req, { signal: ctrl.signal }), timed]);
        clearTimeout(timer);
        if (isBasicOk(res)) cache.put(req, res.clone()).catch(() => {});
        return res;
    } catch (e) {
        clearTimeout(timer);
        return (await cache.match(req)) || Response.error();
    }
}

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    let url;
    try { url = new URL(req.url); } catch (e) { return; }
    if (url.origin !== self.location.origin) return;
    if (DATA_PATH_RE.test(url.pathname)) {
        event.respondWith(networkFirstWithTimeout(req, 1500));
    } else {
        event.respondWith(staleWhileRevalidate(event));
    }
});
