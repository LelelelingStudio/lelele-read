/* ============================================================
   rank-plus.js — 了了了读 · 阅读热度排行榜
   结构对齐 lelele-game/rank-loader.js（Top3 卡片 + 完整榜弹窗 + 双语 + 定时刷新）。
   数据支持远端全站榜 / 阅读记录 / 书库精选三级降级；全异步，失败静默。
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

    /* ---------------- ID 归一化与数据清洗 ---------------- */
    function normId(id) {
        id = String(id === null || id === undefined ? '' : id).trim();
        if (id.indexOf('community_') === 0) id = id.slice(10);
        return id;
    }
    function badId(id) { return !id || /^(empty|undefined|null|none|test|loading|0)$/i.test(id); }
    function clean(list) {
        var seen = {}, out = [], known = Object.keys(byId).length > 0;
        (list || []).forEach(function (orig) {
            var it = Object.assign({}, orig);          /* 不改动缓存数组，避免重复刷新时分数翻倍 */
            var id = normId(it.id);
            if (badId(id)) return;
            if (known && !byId[id] && !(it.name_zh || it.name_en)) return;  /* 丢弃无书名的脏键 */
            it.id = id;
            var b = byId[id] || {};
            if (!it.icon || it.icon === '📖') it.icon = b.icon || it.icon || '📖';
            if (seen[id]) { seen[id].score += it.score; return; }            /* 同一本书合并 */
            seen[id] = it;
            out.push(it);
        });
        return out;
    }

    /* ---------------- 数据适配 ---------------- */
    function normalizePayload(p) {
        if (Array.isArray(p)) return p;
        if (!p || typeof p !== 'object') return [];
        var keys = ['data', 'result', 'list', 'books', 'items', 'records', 'rows', 'ranking', 'top', 'rankings'];
        for (var i = 0; i < keys.length; i++) if (Array.isArray(p[keys[i]])) return p[keys[i]];
        return Object.keys(p).map(function (k) { return p[k]; }).filter(function (v) { return Array.isArray(v); })[0] || [];
    }
    function pickName(it, lg) {
        var zh = it.title_zh || it.name_zh || it.book_zh || it.name || it.title || it.label || '';
        var en = it.title_en || it.name_en || it.book_en || it.title || it.name || it.label || zh;
        return (lg === 'en' ? (en || zh) : (zh || en)) || '';
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
            var id = normId(pickId(it) || pickName(it, 'zh') || pickName(it, 'en'));
            var b = byId[id] || {};
            return {
                id: id,
                name_zh: b.title_zh || it.title_zh || it.name_zh || it.book_zh || it.name || it.title || '',
                name_en: b.title_en || it.title_en || it.name_en || it.book_en || it.name || '',
                name: pickName(it, 'zh') || pickName(it, 'en') || id,
                score: pickScore(it),
                icon: b.icon || (pickIcon(it) === '📖' ? '📖' : pickIcon(it)),
                url: it.url || it.link || it.href || ''
            };
        }).filter(function (x) { return !badId(x.id); });
    }
    function nameOf(it) {
        var lg = lang(), b = byId[it.id] || {};
        return (lg === 'en'
                ? (b.title_en || it.name_en || b.title_zh || it.name_zh)
                : (b.title_zh || it.name_zh || b.title_en || it.name_en))
            || it.name || it.id || '';
    }
    function iconOf(it) { return (byId[it.id] && byId[it.id].icon) || it.icon || '📖'; }
    function hrefOf(it) { return it.url || bookHref(it.id); }
    function sortItems(list) {
        return list.slice().sort(function (a, b) { return b.score - a.score || String(a.name).localeCompare(String(b.name)); });
    }

    /* ---------------- 阅读热度聚合 ---------------- */
    function localRank() {
        var map = {};
        function touch(id) {
            id = normId(id);
            if (badId(id)) return null;
            if (!map[id]) map[id] = { id: id, score: 0, name: '' };
            return map[id];
        }
        arr('recent').forEach(function (r, i) {
            var e = touch(r && r.id);
            if (!e) return;
            e.score += Math.max(1, 8 - i);
            if (r && r.title && !e.name) e.name = r.title;
        });
        arr('favorites').forEach(function (f) {
            var e = touch(f && f.id);
            if (!e) return;
            e.score += 10;
            if (f && f.title && !e.name) e.name = f.title;
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
        var all = books.concat(communityBooks).filter(function (b) { return b && b.id !== 'community'; });
        return all.slice().sort(function (a, b) { return (a.sort || 99) - (b.sort || 99); })
            .slice(0, 12).map(function (b) {
                return { id: b.id, score: 0, name: '', icon: b.icon || '📖', url: bookHref(b.id) };
            });
    }
    function localItems() {
        var raw = localRank();
        if (raw.length) { source = 'ranked'; return unify(raw); }
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
        return t('按阅读热度排序 · 自动更新', 'Sorted by reading popularity · auto-updated');
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
            var hot = source === 'featured' ? t('推荐', 'Pick') : t('热度', 'hot');
            return '<a class="rank-card rank-' + rank + '" href="' + es(hrefOf(it)) + '" aria-label="' + es(nameOf(it)) + '">' +
                '<div class="rank-card-header"><div class="rank-medal">' + medal + '</div>' +
                '<span class="rank-tag">' + (lg === 'en' ? 'Rank ' + rank : '第 ' + rank + ' 名') + '</span></div>' +
                '<div class="rank-main"><div class="rank-icon">' + es(iconOf(it)) + '</div>' +
                '<div class="rank-name">' + es(nameOf(it)) + '</div></div>' +
                '<div class="rank-meta"><div class="rank-count">' +
                (source === 'featured' ? '—' : es(it.score.toLocaleString())) + ' <small>' + es(hot) + '</small></div>' +
                '<span class="rank-link">' + es(t('阅读', 'Read')) + '</span></div></a>';
        }).join('');
    }
    function renderModal() {
        if (!modalList) return;
        var list = items.slice(0, 25);
        if (!list.length) {
            modalList.innerHTML = '<li class="rank-empty">' + es(t('暂无数据', 'No data yet')) + '</li>';
            return;
        }
        modalList.innerHTML = list.map(function (it, i) {
            return '<li class="rank-modal-row">' +
                '<span class="rank-modal-index">' + (i + 1) + '</span>' +
                '<span class="rank-modal-name">' + es(iconOf(it)) + ' ' + es(nameOf(it)) + '</span>' +
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
        var local = sortItems(clean(localItems()));
        var useRemote = !!(remoteItems && remoteItems.length);
        items = useRemote ? sortItems(clean(remoteItems)) : local;
        if (useRemote) source = 'global';
        render();
        fetchRemote().then(function (raw) {
            if (!raw) return;
            var remote = clean(unify(raw));
            if (!remote.length) return;
            remoteItems = remote;
            source = 'global';
            items = sortItems(clean(remoteItems));
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
                if (!on) remoteItems = null;
                refresh();
                UI.toast(on ? t('已启用全站榜单', 'Site-wide ranking enabled') : t('已切回默认榜单', 'Using default ranking'));
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
        refresh();
        loadBooks().then(refresh);
        win.setInterval(refresh, 5 * 60 * 1000);
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
})();
