/* ============================================================
   shelf-plus.js — 首页书架增强
   分类 / 拖拽排序 / 搜索高亮 / 作者筛选 / 新书角标 / 成就勋章 /
   日历热力图 / 时长柱状图 / 连续打卡 / 多收藏夹 / 猜你喜欢 / 问候
   依赖：common.js → common-ui.js；仅在首页（#bookGrid + #readerHub）生效
   ============================================================ */
(function () {
    'use strict';
    if (!window.Lelele) return;

    var L = window.Lelele, Store = L.Store, Bus = L.Bus, UI = L.UI;
    var t = L.t, esc = L.esc, dayKey = UI.dayKey;
    var doc = document;
    function el(id) { return doc.getElementById(id); }
    function node(tag, cls, html) {
        var n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (html !== undefined) n.innerHTML = html;
        return n;
    }
    function toast(m) { UI.toast(m); }
    function warn(m, e) { console.warn('[ShelfPlus:' + m + ']', (e && e.message) || e); }
    function arr(k) { var v = Store.get(k, []); return Array.isArray(v) ? v : []; }
    function obj(k) { var v = Store.get(k, {}); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }

    var books = [];
    var filter = 'all', authorFilter = 'all', folderFilter = 'all';
    var status = obj('shelf_status');
    var order = arr('shelf_order');
    var folders = arr('shelf_folders');
    var recent = arr('recent'), favorites = arr('favorites');

    /* ---------------- 布局 ---------------- */
    var greetEl = null, chipsEl = null, statsEl = null, recEl = null, gridEl = null, hubEl = null;
    function build() {
        var main = doc.querySelector('.main-content');
        hubEl = el('readerHub'); gridEl = el('bookGrid');
        if (!main || !hubEl || !gridEl) return false;
        greetEl = node('div', 'sp-greet'); greetEl.id = 'spGreet';
        main.insertBefore(greetEl, hubEl);
        chipsEl = node('div', 'sp-chips'); chipsEl.id = 'spChips';
        main.insertBefore(chipsEl, hubEl.nextSibling);
        statsEl = node('section', 'sp-stats ll-card'); statsEl.id = 'spStats';
        main.insertBefore(statsEl, chipsEl.nextSibling);
        recEl = node('section', 'sp-recommend'); recEl.id = 'spRecommend';
        main.insertBefore(recEl, statsEl.nextSibling);
        return true;
    }

    /* ---------------- 37 问候 ---------------- */
    function renderGreet() {
        if (!greetEl) return;
        var h = new Date().getHours();
        var g = h < 6 ? ['夜深了', 'Still up?'] : h < 11 ? ['早上好', 'Good morning'] :
            h < 14 ? ['中午好', 'Good afternoon'] : h < 18 ? ['下午好', 'Good afternoon'] : ['晚上好', 'Good evening'];
        greetEl.innerHTML = '<b>' + esc(t(g[0], g[1])) + '</b><span>' +
            esc(t('今天想读点什么？', 'What would you like to read today?')) + '</span>';
    }

    /* ---------------- 29 / 32 / 39 分类、作者、收藏夹 ---------------- */
    var CATS = [
        ['all', '全部', 'All'], ['reading', '在读', 'Reading'],
        ['want', '想读', 'Want to read'], ['finished', '读完', 'Finished'], ['fav', '收藏', 'Favorites']
    ];
    function renderChips() {
        if (!chipsEl) return;
        recent = arr('recent'); favorites = arr('favorites'); folders = arr('shelf_folders');
        var authors = {};
        books.forEach(function (b) { if (b.author) authors[b.author] = 1; });
        chipsEl.innerHTML =
            '<div class="ll-chip-row">' + CATS.map(function (c) {
                return '<button type="button" class="ll-chip' + (filter === c[0] ? ' active' : '') + '" data-cat="' + c[0] + '">' + esc(t(c[1], c[2])) + '</button>';
            }).join('') + '</div>' +
            '<div class="sp-filters">' +
            '<label class="ll-muted">' + esc(t('作者', 'Author')) + ' <select id="spAuthor"><option value="all">' + esc(t('全部', 'All')) + '</option>' +
            Object.keys(authors).map(function (a) {
                return '<option value="' + esc(a) + '"' + (authorFilter === a ? ' selected' : '') + '>' + esc(a) + '</option>';
            }).join('') + '</select></label>' +
            '<label class="ll-muted">' + esc(t('收藏夹', 'Folder')) + ' <select id="spFolder"><option value="all">' + esc(t('全部', 'All')) + '</option>' +
            '<option value=""' + (folderFilter === '' ? ' selected' : '') + '>' + esc(t('未分组', 'Unsorted')) + '</option>' +
            folders.map(function (f) {
                return '<option value="' + esc(f.id) + '"' + (folderFilter === f.id ? ' selected' : '') + '>' + esc(f.name) + '</option>';
            }).join('') + '</select></label>' +
            '<button type="button" class="rd-btn" id="spNewFolder">+ ' + esc(t('新建收藏夹', 'New folder')) + '</button>' +
            (folderFilter !== 'all' && folderFilter !== '' ? '<button type="button" class="rd-btn" id="spDelFolder">' + esc(t('删除该夹', 'Delete folder')) + '</button>' : '') +
            '</div>';
        Array.prototype.forEach.call(chipsEl.querySelectorAll('[data-cat]'), function (b) {
            b.onclick = function () { filter = b.dataset.cat; renderChips(); applyAll(); };
        });
        el('spAuthor').onchange = function () { authorFilter = this.value; applyAll(); };
        el('spFolder').onchange = function () { folderFilter = this.value; renderChips(); applyAll(); };
        el('spNewFolder').onclick = function () {
            var name = prompt(t('新收藏夹名称', 'New folder name'));
            if (!name || !name.trim()) return;
            folders.push({ id: 'f' + Date.now(), name: name.trim() });
            Store.set('shelf_folders', folders);
            folderFilter = folders[folders.length - 1].id;
            renderChips(); applyAll();
        };
        if (el('spDelFolder')) el('spDelFolder').onclick = function () {
            folders = folders.filter(function (f) { return f.id !== folderFilter; });
            Store.set('shelf_folders', folders);
            favorites.forEach(function (f) { if (f.folder === folderFilter) delete f.folder; });
            Store.set('favorites', favorites);
            folderFilter = 'all';
            renderChips(); applyAll();
            toast(t('收藏夹已删除，书仍在收藏中', 'Folder deleted; books remain in favorites'));
        };
    }

    /* ---------------- 25 / 26 / 34 / 35 统计与图表 ---------------- */
    function streak() {
        var d = Store.daily(), n = 0, dt = new Date();
        for (var i = 0; i < 400; i++) {
            var k = dayKey(dt);
            if (d[k] && (d[k].seconds || 0) > 0) n++;
            else if (i > 0) break;
            dt.setDate(dt.getDate() - 1);
        }
        return n;
    }
    function totals() {
        var d = Store.daily(), seconds = 0, notes = 0;
        Object.keys(d).forEach(function (k) {
            seconds += d[k].seconds || 0;
            notes += (d[k].highlights || 0) + (d[k].bookmarks || 0) + (d[k].annotations || 0);
        });
        return { seconds: seconds, notes: notes, totalStats: Store.get('stats', {}) };
    }
    function achievements() {
        var tt = totals(), s = streak(), finished = Object.keys(status).filter(function (k) { return status[k] === 'finished'; }).length;
        return [
            { icon: '📖', ok: tt.seconds > 0, zh: '开卷有益', en: 'First page', desc: t('完成首次阅读', 'Read for the first time') },
            { icon: '🔥', ok: s >= 3, zh: '连续三天', en: '3-day streak', desc: t('连续阅读 3 天', 'Read 3 days in a row') },
            { icon: '🏅', ok: s >= 7, zh: '七日不辍', en: '7-day streak', desc: t('连续阅读 7 天', 'Read 7 days in a row') },
            { icon: '★', ok: favorites.length >= 1, zh: '慧眼识书', en: 'First favorite', desc: t('收藏第一本书', 'Favorite a book') },
            { icon: '🖍️', ok: tt.notes >= 10, zh: '笔耕不辍', en: '10 notes', desc: t('留下 10 条笔记', 'Leave 10 notes') },
            { icon: '✅', ok: finished >= 1, zh: '读完一本', en: 'First finish', desc: t('标记一本为读完', 'Mark a book finished') },
            { icon: '⏳', ok: tt.seconds >= 36000, zh: '十小时', en: '10 hours', desc: t('累计阅读 10 小时', 'Read for 10 hours') }
        ];
    }
    function renderStats() {
        if (!statsEl) return;
        var d = Store.daily();
        var cells = [], today = new Date();
        for (var i = 90; i >= 0; i--) {
            var dt = new Date(today); dt.setDate(dt.getDate() - i);
            var k = dayKey(dt), sec = (d[k] && d[k].seconds) || 0;
            var lvl = sec >= 3600 ? 4 : sec >= 1800 ? 3 : sec >= 600 ? 2 : sec > 0 ? 1 : 0;
            cells.push('<div class="ll-heat-cell' + (lvl ? ' ll-heat-' + lvl : '') + '" title="' + k + ' · ' + Math.round(sec / 60) + ' min"></div>');
        }
        var series = [], max = 1;
        for (var j = 6; j >= 0; j--) {
            var dd = new Date(today); dd.setDate(dd.getDate() - j);
            var min = Math.round(((d[dayKey(dd)] || {}).seconds || 0) / 60);
            series.push({ label: (dd.getMonth() + 1) + '/' + dd.getDate(), min: min });
            max = Math.max(max, min);
        }
        var bars = series.map(function (s) {
            return '<div class="ll-bar-wrap"><div class="ll-bar' + (s.min ? '' : ' dim') + '" style="height:' + Math.max(3, s.min / max * 76) + 'px"></div><span class="ll-bar-label">' + esc(s.label) + '</span></div>';
        }).join('');
        var badges = achievements().map(function (a) {
            return '<div class="sp-badge' + (a.ok ? ' got' : '') + '" title="' + esc(a.desc) + '"><span>' + a.icon + '</span><small>' + esc(t(a.zh, a.en)) + '</small></div>';
        }).join('');
        statsEl.innerHTML =
            '<div class="ll-section-title">📊 ' + esc(t('我的阅读', 'My reading')) +
            '<span class="ll-badge">🔥 ' + streak() + ' ' + esc(t('天连续', 'day streak')) + '</span></div>' +
            '<div class="sp-grid"><div><h5>' + esc(t('近 7 天阅读时长', 'Last 7 days')) + '</h5><div class="ll-bars">' + bars + '</div></div>' +
            '<div><h5>' + esc(t('近 13 周日历', 'Last 13 weeks')) + '</h5><div class="ll-heatmap">' + cells.join('') + '</div>' +
            '<p class="ll-muted" style="margin-top:8px">' + esc(t('颜色越深，当天读得越久', 'Darker means more reading that day')) + '</p></div></div>' +
            '<h5 style="margin:18px 0 8px">' + esc(t('成就勋章', 'Achievements')) + '</h5><div class="sp-badges">' + badges + '</div>' +
            '<div class="ll-row" style="margin-top:16px"><span class="ll-muted">' + esc(UI.usageText()) + '</span>' +
            '<button type="button" class="rd-btn" id="spBackup">' + esc(t('备份 / 导入数据', 'Backup / restore')) + '</button></div>';
        el('spBackup').onclick = function () { UI.openBackup(); };
    }

    /* ---------------- 40 猜你喜欢 ---------------- */
    function renderRecommend() {
        if (!recEl) return;
        if (!books.length) { recEl.innerHTML = ''; return; }
        recent = arr('recent'); favorites = arr('favorites');
        var weights = {};
        recent.concat(favorites).forEach(function (r) {
            var b = books.filter(function (x) { return x.id === r.id; })[0];
            if (b && b.cat) weights[b.cat] = (weights[b.cat] || 0) + 2;
        });
        var seen = {};
        recent.concat(favorites).forEach(function (r) { seen[r.id] = 1; });
        var picks = books.filter(function (b) { return !seen[b.id] && weights[b.cat]; })
            .sort(function (a, b) { return (weights[b.cat] || 0) - (weights[a.cat] || 0) || (a.sort || 99) - (b.sort || 99); })
            .slice(0, 4);
        if (!picks.length) picks = books.slice(0, 4);
        if (!picks.length) return;
        recEl.innerHTML = '<div class="ll-section-title">✨ ' + esc(t('猜你喜欢', 'You might like')) + '</div><div class="ll-row-scroll">' +
            picks.map(function (b) {
                var title = t(b.title_zh || b.title_en, b.title_en || b.title_zh);
                return '<button type="button" class="sp-rec" data-id="' + esc(b.id) + '"><span>' + esc(b.icon || '📖') + '</span><b>' + esc(title) + '</b><small>' + esc(t(b.desc_zh || '', b.desc_en || '').slice(0, 40)) + '</small></button>';
            }).join('') + '</div>';
        Array.prototype.forEach.call(recEl.querySelectorAll('[data-id]'), function (b) {
            b.onclick = function () { location.href = 'reader.html?book=' + encodeURIComponent(b.dataset.id); };
        });
    }

    /* ---------------- 31 / 33 搜索高亮与新书角标 ---------------- */
    function highlightCard(card) {
        var kw = ((el('searchInput') || {}).value || '').trim();
        ['book-title', 'book-desc'].forEach(function (cls) {
            var n = card.querySelector('.' + cls); if (!n) return;
            if (!n.dataset.orig) n.dataset.orig = n.textContent;
            var orig = n.dataset.orig;
            if (!kw) { n.textContent = orig; return; }
            var i = orig.toLowerCase().indexOf(kw.toLowerCase());
            if (i < 0) { n.textContent = orig; return; }
            n.innerHTML = esc(orig.slice(0, i)) + '<span class="ll-mark">' + esc(orig.slice(i, i + kw.length)) + '</span>' + esc(orig.slice(i + kw.length));
        });
    }
    function isNew(id) {
        if (!books.length) return false;
        var max = 0;
        books.forEach(function (b) { max = Math.max(max, Number(b.sort) || 0); });
        var b = books.filter(function (x) { return x.id === id; })[0];
        var s = b ? (Number(b.sort) || 0) : 0;
        return !!b && max > 0 && s > 0 && s >= max - 1;
    }
    var STATUS_ICON = { '': '＋', reading: '📖', want: '🔖', finished: '✅' };
    function inRecent(id) { return recent.some(function (r) { return r.id === id; }); }
    function catMatch(id) {
        if (filter === 'all') return true;
        if (filter === 'fav') return favorites.some(function (f) { return f.id === id; });
        var s = status[id] || (inRecent(id) ? 'reading' : '');
        return s === filter;
    }
    function cycleStatus(id) {
        var seq = ['', 'want', 'finished', 'reading'];
        var cur = status[id] || (inRecent(id) ? 'reading' : '');
        var next = seq[(seq.indexOf(cur) + 1) % seq.length];
        if (next) status[id] = next; else delete status[id];
        Store.set('shelf_status', status);
        toast(next ? t('已标记为：', 'Marked as: ') + t({ reading: '在读', want: '想读', finished: '读完' }[next], next) : t('已清除状态', 'Status cleared'));
        renderStats(); applyAll();
    }

    /* ---------------- 30 拖拽排序 ---------------- */
    var dragId = null;
    function saveOrder() {
        order = Array.prototype.map.call(gridEl.querySelectorAll('.book-card'), function (c) { return c.dataset.bookId; });
        Store.set('shelf_order', order);
    }
    function bindDrag(card) {
        card.draggable = true;
        card.addEventListener('dragstart', function (e) {
            dragId = card.dataset.bookId; card.classList.add('ll-sortable');
            if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); }
        });
        card.addEventListener('dragend', function () { card.classList.remove('ll-sortable'); dragId = null; });
        card.addEventListener('dragover', function (e) { e.preventDefault(); });
        card.addEventListener('drop', function (e) {
            e.preventDefault(); e.stopPropagation();
            if (!dragId || dragId === card.dataset.bookId) return;
            var moving = Array.prototype.filter.call(gridEl.querySelectorAll('.book-card'), function (c) {
                return c.dataset.bookId === dragId;
            })[0];
            if (moving) gridEl.insertBefore(moving, card);
            saveOrder();
            toast(t('书架顺序已保存', 'Shelf order saved'));
        });
    }

    /* ---------------- 卡片增强 ---------------- */
    function enhanceCards() {
        if (!gridEl) return;
        recent = arr('recent'); favorites = arr('favorites'); status = obj('shelf_status'); order = arr('shelf_order');
        var cards = Array.prototype.slice.call(gridEl.querySelectorAll('.book-card'));
        if (!cards.length) return;
        if (order.length) {
            cards.sort(function (a, b) {
                var ia = order.indexOf(a.dataset.bookId), ib = order.indexOf(b.dataset.bookId);
                return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
            });
            cards.forEach(function (c) { gridEl.appendChild(c); });
        }
        cards.forEach(function (c) {
            var id = c.dataset.bookId;
            if (c.dataset.spDone !== '1') {
                c.dataset.spDone = '1';
                var b = node('button', 'sp-status'); b.type = 'button';
                b.title = t('切换阅读状态', 'Cycle reading status');
                c.appendChild(b);
                b.onclick = function (e) { e.stopPropagation(); cycleStatus(id); };
                if (isNew(id)) c.appendChild(node('span', 'll-badge new sp-new', 'NEW'));
                bindDrag(c);
            }
            var b2 = c.querySelector('.sp-status');
            if (b2) {
                var s = status[id] || (inRecent(id) ? 'reading' : '');
                b2.textContent = STATUS_ICON[s] || '＋';
                b2.dataset.status = s;
            }
            var show = catMatch(id) && (authorFilter === 'all' || c.dataset.author === authorFilter);
            c.hidden = !show;
            highlightCard(c);
        });
    }

    /* ---------------- 书架卡片过滤与收藏夹 ---------------- */
    function cycleFolder(id) {
        var f = favorites.filter(function (x) { return x.id === id; })[0];
        if (!f) return;
        var seq = [''].concat(folders.map(function (x) { return x.id; }));
        var cur = f.folder || '';
        var next = seq[(seq.indexOf(cur) + 1) % seq.length];
        if (next) f.folder = next; else delete f.folder;
        Store.set('favorites', favorites);
        enhanceHub();
        toast(next ? t('已移入收藏夹', 'Moved to folder') : t('已移出收藏夹', 'Moved to unsorted'));
    }
    function enhanceHub() {
        if (!hubEl) return;
        favorites = arr('favorites'); folders = arr('shelf_folders'); status = obj('shelf_status');
        Array.prototype.forEach.call(hubEl.querySelectorAll('.shelf-card'), function (c) {
            var id = c.dataset.bookId, kind = c.dataset.kind;
            var show = true;
            if (filter === 'fav') show = kind === 'fav';
            else if (filter === 'reading') show = kind === 'recent';
            else if (filter === 'want' || filter === 'finished') show = status[id] === filter;
            if (show && kind === 'fav' && folderFilter !== 'all') {
                var f = favorites.filter(function (x) { return x.id === id; })[0];
                var fid = (f && f.folder) || '';
                show = fid === folderFilter;
            }
            c.hidden = !show;
            if (kind === 'fav' && !c.querySelector('.sp-folder-btn')) {
                var b = node('button', 'sp-folder-btn', '📁');
                b.type = 'button'; b.title = t('切换收藏夹', 'Change folder');
                b.onclick = function (e) { e.stopPropagation(); cycleFolder(id); };
                c.appendChild(b);
            }
        });
        // 隐藏空的分组标题
        Array.prototype.forEach.call(hubEl.querySelectorAll('.shelf-row'), function (row) {
            var any = Array.prototype.some.call(row.querySelectorAll('.shelf-card'), function (c) { return !c.hidden; });
            var title = row.previousElementSibling;
            if (title && title.classList.contains('shelf-title')) title.hidden = !any;
            row.hidden = !any;
        });
    }

    function applyAll() { enhanceCards(); enhanceHub(); }

    /* ---------------- 初始化 ---------------- */
    function init() {
        if (!build()) return;
        renderGreet(); renderChips(); renderStats(); renderRecommend(); applyAll();

        var mt = null, ht = null;
        if ('MutationObserver' in window) {
            var obs = new MutationObserver(function () {
                clearTimeout(mt); mt = setTimeout(function () { enhanceCards(); enhanceHub(); }, 40);
            });
            obs.observe(gridEl, { childList: true });
            obs.observe(hubEl, { childList: true });
        }
        var search = el('searchInput');
        if (search) search.addEventListener('input', function () {
            clearTimeout(ht); ht = setTimeout(enhanceCards, 180);
        });
        window.addEventListener('langChanged', function () {
            renderGreet(); renderChips(); renderStats(); renderRecommend(); applyAll();
        });
        Bus.on('storage', function (p) {
            if (p.self) return;
            if (['recent', 'favorites', 'daily', 'stats', 'shelf_status', 'shelf_folders', 'shelf_order'].indexOf(p.key) >= 0) {
                renderStats(); applyAll();
            }
        });
        Bus.on('backupImported', function () { renderChips(); renderStats(); applyAll(); });

        fetch('data/books.json').then(function (r) { return r.json(); }).then(function (data) {
            books = Array.isArray(data) ? data : [];
            renderChips(); renderRecommend(); applyAll();
        }).catch(function (e) { warn('books', e); });

        UI.registerCommand({ id: 'sp-backup', zh: '数据备份与迁移', en: 'Backup & restore', icon: '⇩', section: 'Library', run: function () { UI.openBackup(); } });
        UI.registerCommand({ id: 'sp-reset-filter', zh: '清除书架筛选', en: 'Clear shelf filters', icon: '✕', section: 'Library', run: function () {
            filter = 'all'; authorFilter = 'all'; folderFilter = 'all'; renderChips(); applyAll();
        } });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();

    window.ShelfPlus = { refresh: function () { renderStats(); applyAll(); } };
})();
