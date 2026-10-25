// =========================================
// sw.js - Service Worker (离线缓存)
// =========================================
const CACHE_NAME = 'lelele-read-v1';

// 需要预缓存的核心资源
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/common.css',
    '/common.js',
    '/reader.css',
    '/reader.js',
    '/window.css',
    '/window.js',
    '/manifest-zh.json',
    '/manifest-en.json',
    '/icon-192.png',
    '/icon-512.png'
];

// 1. 安装阶段：缓存核心文件
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(PRECACHE_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// 2. 激活阶段：清理旧缓存
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// 3. 拦截请求：网络优先，失败则回退到缓存
self.addEventListener('fetch', event => {
    // 只拦截同源请求 (避免干扰外部 API)
    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // 如果是成功响应，克隆一份存入缓存（动态更新）
                if (response.ok && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            })
            .catch(() => {
                // 网络请求失败，从缓存中找
                return caches.match(event.request);
            })
    );
});