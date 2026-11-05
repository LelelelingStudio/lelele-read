/* ============================================================
   rank-plus.js — 了了了读 · 阅读热度排行榜
   结构对齐 lelele-game/rank-loader.js（Top3 卡片 + 完整榜弹窗 + 双语 + 定时刷新），
   域名与数据改为阅读站：优先 analytics 的 readcheck，失败回退本机阅读数据，
   再兜底书库精选。全异步、不阻塞首屏，任何一步失败都静默降级。
   依赖：common.js → common-ui.js（window.Lelele）
   ============================================================ */
(function () {
    'use strict';
    if (!window.Lelele || !window.Lelele.Store) return;
    var L = window.Lelele, Store = L.Store, Bus = L.Bus, UI = L.UI;
    var doc = document, win = window;

    function t(zh, en) { return L.t(zh, en); }
    function es(s) { return L.esc(s === null || s === undefined ? '' : s); }
    function warn(m, e) { console.warn('[RankPlus:' + m + ']', (e && e.message) || e); }
    function el(id) { return doc.getElementById(id); }
    function node(tag, cls, html) {
        var n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (html !== undefined) n.innerHTML = html;
        return n;
    }
    function arr(k) { var v = Store.get(k, []); return Array.isArray(v) ? v : []; }
    function obj(k) { var v = Store.get(k, {}); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
    function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
    function lang() { return doc.documentElement.getAttribute('data-lang') || 'zh'; }

    var REMOTE_BASE = 'https://analytics.leleleling.site/readcheck';
    var section = null, topRoot = null, modal = null, modalList = null, sourceEl = null;
    var books = [], communityBooks = [], byId = {};
    var items = [], remoteItems = null, source = 'featured', remoteTried = false;

    /* ---------------- 数据适配（与了了了游同构） ---------------- */
    function normalizePayload(p) {
        if (Array.isArray(p)) return p;
        if (!p || typeof p !== 'object') return [];
        var keys = ['data', 'result', 'list', 'books', 'items', 'records', 'rows', 'ranking', 'top', 'rankings'];
        for (var i = 0; i < keys.length; i++) if (Array.isArray(p[keys[i]])) return p[keys[i]];
        var first = Object.keys(p).map(function (k) { return p[k]; }).filter(function (v) { return Array.isArray(v); })[0];
        return first || [];
    }
    function pickName(it, lg) {
        var zh = it.title_zh || it.name_zh || it.book_zh || it.name || it.title || it.label || '';
        var en = it.title_en || it.name_en || it.book_en || it.title || it.name || it.label || zh;
        return (lg === 'en' ? (en || zh) : (zh || en)) || it.id || '';
    }
    function pickScore(it) {
        return num(it.score != null ? it.score : (it.value != null ? it.value :
            (it.count != null ? it.count : (it.views != null ? it.views : it.hot))));
    }
    function pickId(it) { return it.id || it.bookId || it.book_id || it.slug || it.key || it.code || ''; }
    function pickIcon(it) { return it.icon || it.emoji || it.symbol || '📖'; }

    function bookHref(id) {
        var b = byId[id];
        if (b && b.id === 'community') return 'data/community/index.html';
        if (b) return 'reader.html?book=' + encodeURIComponent(b.id);
        return 'data/community/reader.html?id=' + encodeURIComponent(id);
    }
    function unify(raw) {
        return (raw || []).map(function (it) {
            var id = pickId(it) || pickName(it, 'zh') || pickName(it, 'en');
            var b = byId[id] || {};
            return {
                id: id,
                name_zh: b.title_zh || it.title_zh || it.name_zh || it.book_zh || it.name || it.title || '',
                name_en: b.title_en || it.title_en || it.name_en || it.book_en || it.name || '',
                name: pickName(it, 'zh') || pickName(it, 'en') || id,
                score: pickScore(it),
                icon: pickIcon(it) === '📖' ? (b.icon || '📖') : pickIcon(it),
                url: it.url || it.link || it.href || ''
            };
        }).filter(function (x) { return x.id || x.name_zh || x.name_en || x.name; });
    }
    function nameOf(it) {
        /* 书目是异步加载的，渲染时再查一次，避免远端只给 id 时书名留空 */
        var lg = lang(), b = byId[it.id] || {};
        return (lg === 'en'
                ? (b.title_en || it.name_en || b.title_zh || it.name_zh)
                : (b.title_zh || it.name_zh || b.title_en || it.name_en))
            || it.name || it.id || '';
    }
    function hrefOf(it) { return it.url || bookHref(it.id); }
    function sortItems(list) {
        return list.slice().sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); });
    }

    /* ---------------- 本机阅读热度 ---------------- */
    function localRank() {
        var map = {};
        function touch(id) {
            if (!id) return null;
            id = String(id);
            if (!map[id]) map[id] = { id: id, score: 0, name: '' };
            return map[id];
        }
        arr('recent').forEach(function (r, i) {
            var e = touch(r && r.id);
            if (!e) return;
            e.score += Math.max(1, 8 - i);
            if (r && r.title) e.name = r.title;
        });
        arr('favorites').forEach(function (f) {
            var e = touch(f && f.id);
            if (!e) return;
            e.score += 10;
            if (f && f.title) e.name = f.title;
        });
        try {
            Store.keys().forEach(function (k) {
                if (k.indexOf('notes_') === 0) {
                    var e = touch(k.slice(6));
                    var n = Store.get(k, {});
                    if (e && n && typeof n === 'object') {
                        e.score += (n.highlights || []).length * 2 +
                            (n.bookmarks || []).length * 3 +
                            (n.annotations || []).length * 3;
                    }
                } else if (k.indexOf('progress_') === 0) {
                    var p = touch(k.slice(9));
                    if (p) p.score += 5;
                }
            });
        } catch (e) { warn('localKeys', e); }
        var status = obj('shelf_status');
        Object.keys(status).forEach(function (id) {
            var e = touch(id);
            if (e) e.score += (status[id] === 'finished' ? 8 : status[id] ? 3 : 0);
        });
        return Object.keys(map).map(function (k) { return map[k]; })
            .filter(function (x) { return x.score > 0; });
    }
    function featured() {
        var all = books.concat(communityBooks.map(function (b) { return Object.assign({ isCommunity: true }, b); }));
        return all.slice().sort(function (a, b) { return (a.sort || 99) - (b.sort || 99); })
            .slice(0, 12).map(function (b, i) {
                return { id: b.id, score: 0, name: '', rank: i, icon: b.icon || '📖',
                    url: b.isCommunity ? 'data/community/reader.html?id=' + encodeURIComponent(b.id) : bookHref(b.id) };
            });
    }
    function localItems() {
        var raw = localRank();
        if (raw.length) { source = 'local'; return unify(raw); }
        source = 'featured';
        return featured().map(function (x) {
            var b = byId[x.id] || {};
            return {
                id: x.id,
                name_zh: b.title_zh || b.title_en || x.id,
                name_en: b.title_en || b.title_zh || x.id,
                name: b.title_zh || b.title_en || x.id,
                score: 0, icon: x.icon, url: x.url
            };
        });
    }

    /* ---------------- 远端全站榜（可选，失败静默） ---------------- */
    function fetchText(url, ms) {
        return new Promise(function (resolve, reject) {
            var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
            var timer = setTimeout(function () { if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, ms || 3000);
            fetch(url, { mode: 'cors', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
                .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
                .then(function (text) { clearTimeout(timer); resolve(text); })
                .catch(function (e) { clearTimeout(timer); reject(e); });
        });
    }
    /* 全站榜默认关闭：analytics 未部署 readcheck 时，请求只会产生 404 与控制台报错。
       部署端点后用 window.RANK_ENDPOINT，或命令面板「启用全站热度」打开即可。 */
    function remoteBase() {
        if (win.RANK_ENDPOINT) return String(win.RANK_ENDPOINT);
        return Store.get('rank_remote', false) === true ? REMOTE_BASE : '';
    }
    function fetchRemote() {
        if (remoteTried) return Promise.resolve(null);
        var base = remoteBase();
        if (!base) return Promise.resolve(null);
        remoteTried = true;
        var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'lang=' + encodeURIComponent(lang());
        return fetchText(url, 3000)
            .then(function (text) {
                var payload;
                try { payload = JSON.parse(text); } catch (e) { return null; }
                var raw = normalizePayload(payload);
                return raw.length ? raw : null;
            })
            .catch(function () { return null; });
    }

    /* ---------------- 渲染 ---------------- */
    function sourceLabel() {
        if (source === 'global') return t('数据来源：全站阅读热度', 'Source: site-wide reading activity');
        if (source === 'local') return t('数据来源：本机阅读记录（不会上传）', 'Source: your reading on this device (never uploaded)');
        return t('暂无阅读记录，先为你推荐书库精选', 'No reading yet — here are library picks');
    }
    function renderTop() {
        if (!topRoot) return;
        var lg = lang(), top = items.slice(0, 3);
        if (!top.length) {
            topRoot.innerHTML = '<div class="rank-empty">' + es(t('暂无数据', 'No data yet')) + '</div>';
            return;
        }
        topRoot.innerHTML = top.map(function (it, i) {
            var rank = i + 1;
            var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
            var hot = source === 'featured' ? t('精选', 'Pick') : t('热度', 'hot');
            return '<a class="rank-card rank-' + rank + '" href="' + es(hrefOf(it)) + '" aria-label="' + es(nameOf(it)) + '">' +
                '<div class="rank-card-header"><div class="rank-medal">' + medal + '</div>' +
                '<span class="rank-tag">' + (lg === 'en' ? 'Rank ' + rank : '第 ' + rank + ' 名') + '</span></div>' +
                '<div class="rank-main"><div class="rank-icon">' + es(it.icon) + '</div>' +
                '<div class="rank-name">' + es(nameOf(it)) + '</div></div>' +
                '<div class="rank-meta"><div class="rank-count">' +
                (source === 'featured' ? '—' : es(it.score.toLocaleString())) + ' <small>' + es(hot) + '</small></div>' +
                '<span class="rank-link">' + es(t('阅读', 'Read')) + '</span></div></a>';
        }).join('');
    }
    function renderModal() {
        if (!modalList) return;
        var lg = lang(), list = items.slice(0, 25);
        if (!list.length) {
            modalList.innerHTML = '<li class="rank-empty">' + es(t('暂无数据', 'No data yet')) + '</li>';
            return;
        }
        modalList.innerHTML = list.map(function (it, i) {
            return '<li class="rank-modal-row">' +
                '<span class="rank-modal-index">' + (i + 1) + '</span>' +
                '<span class="rank-modal-name">' + es(it.icon) + ' ' + es(nameOf(it)) + '</span>' +
                '<span class="rank-modal-count">' + (source === 'featured' ? '—' : es(it.score.toLocaleString())) + '</span>' +
                '<a class="rank-modal-link" href="' + es(hrefOf(it)) + '">' + es(t('阅读', 'Open')) + '</a></li>';
        }).join('');
    }
    function render() { renderTop(); renderModal(); if (sourceEl) sourceEl.textContent = sourceLabel(); }
    function openModal() {
        if (!modal) return;
        renderModal();
        modal.hidden = false;
        if (win.leleleTrack) win.leleleTrack('rank_open');
    }
    function closeModal() { if (modal) modal.hidden = true; }

    /* ---------------- 初始化 ---------------- */
    function loadBooks() {
        function get(url) {
            return fetchText(url, 8000).then(function (text) {
                try { return JSON.parse(text); } catch (e) { return []; }
            }).catch(function () { return []; });
        }
        return Promise.all([get('data/books.json'), get('data/community/books.json')])
            .then(function (res) {
                books = Array.isArray(res[0]) ? res[0] : [];
                communityBooks = Array.isArray(res[1]) ? res[1] : [];
                books.concat(communityBooks).forEach(function (b) { if (b && b.id) byId[b.id] = b; });
            });
    }
    function refresh() {
        /* localItems 会设定 local / featured；远端结果优先，且跨刷新保持 */
        var local = sortItems(localItems());
        var useRemote = !!(remoteItems && remoteItems.length);
        items = useRemote ? sortItems(remoteItems) : local;
        if (useRemote) source = 'global';
        render();
        fetchRemote().then(function (raw) {
            if (!raw) return;
            var remote = unify(raw);
            if (!remote.length) return;
            remoteItems = remote;
            source = 'global';
            items = sortItems(remote);
            render();
        });
    }
    function bind() {
        var more = el('openRankModalBtn');
        if (more) more.addEventListener('click', openModal);
        var close = el('rankModalCloseBtn');
        if (close) close.addEventListener('click', closeModal);
        if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
        doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
        win.addEventListener('langChanged', render);
        ['recent', 'favorites', 'shelf_status', 'daily', 'stats'].forEach(function (k) {
            Bus.on('storage:' + k, function (p) { if (!p.self) refresh(); });
        });
        Bus.on('backupImported', function () { remoteTried = false; refresh(); });
        UI.registerCommand({
            id: 'rank-open', zh: '打开阅读排行榜', en: 'Open reading leaderboard', icon: '🏆',
            section: 'Books', keywords: 'rank leaderboard 排行', run: openModal
        });
        UI.registerCommand({
            id: 'rank-remote', zh: '排行榜：切换全站热度', en: 'Leaderboard: toggle site-wide data', icon: '☁',
            section: 'Books', keywords: 'remote analytics 全站', run: function () {
                var on = Store.get('rank_remote', false) !== true;
                Store.set('rank_remote', on);
                remoteTried = false;
                refresh();
                UI.toast(on ? t('已启用全站榜单', 'Site-wide ranking enabled') : t('已使用本机榜单', 'Using on-device ranking'));
            }
        });
    }
    function build() {
        var main = doc.querySelector('.main-content'), grid = el('bookGrid');
        if (!main || !grid || el('rankShowcase')) return false;
        section = node('section', 'rank-showcase');
        section.id = 'rankShowcase';
        section.innerHTML =
            '<div class="rank-header"><div>' +
            '<h3><span class="zh-inline">🏆 热门书籍</span><span class="en-inline">🏆 Top Books</span></h3>' +
            '<span class="rank-subtitle"><span class="zh-inline">阅读热度榜</span><span class="en-inline">Reading popularity ranking</span></span>' +
            '</div><button type="button" class="rank-more-btn" id="openRankModalBtn">' +
            '<span class="zh-inline">查看更多</span><span class="en-inline">View more</span></button></div>' +
            '<div class="rank-grid" id="top3RankContainer"></div>' +
            '<div class="rank-source" id="rankSource"></div>';
        main.insertBefore(section, grid);
        topRoot = el('top3RankContainer');
        sourceEl = el('rankSource');

        modal = node('div', 'll-overlay rank-modal');
        modal.id = 'rankModalOverlay';
        modal.hidden = true;
        modal.innerHTML = '<div class="ll-panel rank-panel"><div class="ll-panel-head">' +
            '<h3><span class="zh-inline">📖 阅读排行榜</span><span class="en-inline">📖 Reading leaderboard</span></h3>' +
            '<button type="button" class="ll-x" id="rankModalCloseBtn" aria-label="Close">×</button></div>' +
            '<div class="ll-panel-body"><ul class="rank-modal-list" id="rankModalList"></ul></div></div>';
        doc.body.appendChild(modal);
        modalList = el('rankModalList');
        return true;
    }
    function init() {
        if (!build()) return;
        bind();
        refresh();                       /* 先用本机数据即时出榜 */
        loadBooks().then(refresh);        /* 书目到达后补齐书名与封面 */
        win.setInterval(refresh, 5 * 60 * 1000);
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
})();
