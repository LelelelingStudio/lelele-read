/* ============================================================
   pages-plus.js — 社区书库 / 作者面板 / 作者主页 / 关于 / 文档 的增强
   依赖：common.js → common-ui.js（window.Lelele）
   方式：纯 DOM 装饰 + MutationObserver，不接管各页原有渲染与数据流；
        不请求任何外部服务，状态一律写入 lelele_read_ 前缀的本地存储。
   ============================================================ */
(function () {
    'use strict';
    if (!window.Lelele || !window.Lelele.UI) return;
    var L = window.Lelele, Store = L.Store, Bus = L.Bus, UI = L.UI;
    var doc = document, win = window;

    function t(zh, en) { return L.t(zh, en); }
    function es(s) { return L.esc(s === null || s === undefined ? '' : s); }
    function toast(m) { UI.toast(m); }
    function warn(m, e) { console.warn('[PagesPlus:' + m + ']', (e && e.message) || e); }
    function el(id) { return doc.getElementById(id); }
    function node(tag, cls, html) {
        var n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (html !== undefined) n.innerHTML = html;
        return n;
    }
    function arr(k) { var v = Store.get(k, []); return Array.isArray(v) ? v : []; }
    function obj(k) { var v = Store.get(k, {}); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
    function hash(s) {
        var h = 2166136261;
        s = String(s || '');
        for (var i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = win.Math && Math.imul ? Math.imul(h, 16777619) : (h * 16777619) | 0;
        }
        return h >>> 0;
    }
    function coverBg(seed) {
        var h = hash(seed) % 360, h2 = (h + 42) % 360;
        return 'linear-gradient(135deg, hsla(' + h + ',56%,76%,.88), hsla(' + h2 + ',46%,58%,.78))';
    }
    function initialOf(title, desc) {
        var s = String(desc || '').replace(/\s+/g, '');
        var sentence = s.split(/[。！？.!?；;，,：:]/)[0] || String(title || '');
        var c = sentence.charAt(0) || String(title || '书').charAt(0);
        return /[\u4e00-\u9fa5]/.test(c) ? c : c.toUpperCase();
    }
    function observe(target, fn) {
        if (!win.MutationObserver) { win.setInterval(fn, 1500); return; }
        var scheduled = false;
        var mo = new win.MutationObserver(function () {
            if (scheduled) return;
            scheduled = true;
            win.setTimeout(function () {
                scheduled = false;
                try { fn(); } catch (e) { warn('observe', e); }
            }, 30);
        });
        mo.observe(target, { childList: true });
    }
    function onLang(fn) {
        /* langChanged 由 common-ui 桥接成 Bus 'lang'，两个来源合并成一次执行 */
        var queued = false;
        var run = function () {
            if (queued) return;
            queued = true;
            win.setTimeout(function () {
                queued = false;
                try { fn(); } catch (e) { warn('lang', e); }
            }, 0);
        };
        win.addEventListener('langChanged', run);
        Bus.on('lang', run);
    }
    function onStore(keys, fn) {
        Bus.on('storage', function (p) {
            if (p.self || keys.indexOf(p.key) < 0) return;
            try { fn(p); } catch (e) { warn('storage', e); }
        });
    }
    function highlight(elm, kw) {
        if (!elm || !kw) return;
        var txt = elm.textContent || '', low = txt.toLowerCase(), out = '', pos = 0, i;
        while ((i = low.indexOf(kw, pos)) >= 0) {
            out += es(txt.slice(pos, i)) + '<mark class="ll-mark">' + es(txt.slice(i, i + kw.length)) + '</mark>';
            pos = i + kw.length;
        }
        if (!pos) return;
        elm.innerHTML = out + es(txt.slice(pos));
    }
    function toggleFavorite(id, title, done) {
        var favs = arr('favorites'), at = -1;
        favs.forEach(function (f, i) { if (f && f.id === id) at = i; });
        var added = at < 0;
        if (added) favs.unshift({ id: id, title: title || id, ts: Date.now() });
        else favs.splice(at, 1);
        Store.set('favorites', favs);
        toast(added ? t('已加入收藏', 'Added to favorites') : t('已取消收藏', 'Removed from favorites'));
        if (done) done();
    }
    function isFavorite(id) { return arr('favorites').some(function (f) { return f && f.id === id; }); }
    function statusLabel(s) {
        return t({ reading: '在读', want: '想读', finished: '读完' }[s] || '标记', s || 'mark');
    }
    function cycleStatus(id, done) {
        var status = obj('shelf_status'), seq = ['', 'reading', 'want', 'finished'];
        var next = seq[(seq.indexOf(status[id] || '') + 1) % seq.length];
        if (next) status[id] = next; else delete status[id];
        Store.set('shelf_status', status);
        toast(next ? t('已标记为：', 'Marked as: ') + statusLabel(next) : t('已清除状态', 'Status cleared'));
        if (done) done();
    }
    function bookIdFromHref(href) {
        var m = /[?&](?:book|id)=([^&#]+)/.exec(href || '');
        if (!m) return '';
        try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    function recentWords(days) {
        var d = Store.daily(), sum = 0, dt = new Date();
        for (var i = 0; i < (days || 7); i++) {
            dt.setDate(dt.getDate() - (i ? 1 : 0));
            sum += (d[UI.dayKey(dt)] || {}).words || 0;
        }
        return sum;
    }
    var CATS = {
        all: ['全部', 'All'], classic: ['经典', 'Classics'], poetry: ['诗歌', 'Poetry'],
        essay: ['散文', 'Essays'], novel: ['小说', 'Fiction'], religion: ['宗教', 'Religion'],
        community: ['共创', 'Community'], history: ['历史', 'History'],
        philosophy: ['哲学', 'Philosophy'], science: ['科普', 'Science'], other: ['其他', 'Other']
    };
    function catLabel(c) { var p = CATS[c]; return p ? t(p[0], p[1]) : (c || t('未分类', 'Uncategorized')); }
    function cmd(c) { UI.registerCommand(c); }
    function backupBtn(id) {
        return '<button type="button" class="rd-btn" id="' + id + '">' + es(t('数据备份与迁移', 'Backup & restore')) + '</button>';
    }
    function bindBackup(id) {
        var b = el(id);
        if (b) b.onclick = function () { UI.openBackup(); };
    }
    function usageBlock() {
        var u = Store.usage();
        return '<div class="ll-meter"><span style="width:' + Math.min(100, u.used / u.quota * 100).toFixed(1) + '%"></span></div>' +
            '<p class="ll-usage">' + es(UI.usageText()) + '</p>';
    }

    /* ========================================================
       1. 共创书库：类型 / 语言 / 排序筛选、仅看收藏、渐变封面、
          首句封面字、搜索高亮、本地收藏与阅读状态
       ======================================================== */
    var cp = { cat: 'all', lang: 'all', sort: 'default', favOnly: false };
    var cpGrid = null, cpBar = null, cpEmpty = null, cpSearch = null;

    function communityBooks() {
        try {
            /* 页面内顶层 let 绑定，跨 script 可见；拿不到时退化为 DOM 收集 */
            return (typeof COMMUNITY_BOOKS !== 'undefined' && Array.isArray(COMMUNITY_BOOKS)) ? COMMUNITY_BOOKS : [];
        } catch (e) { return []; }
    }
    function cpCats() {
        var seen = {}, out = [];
        communityBooks().forEach(function (b) { if (b && b.cat) seen[b.cat] = 1; });
        Array.prototype.forEach.call(cpGrid.querySelectorAll('.book-card'), function (c) {
            if (c.dataset.cat) seen[c.dataset.cat] = 1;
        });
        Object.keys(seen).sort().forEach(function (c) { out.push(c); });
        return out;
    }
    function renderCpFilters() {
        if (!cpBar) return;
        var cats = cpCats();
        if (cp.cat !== 'all' && cats.indexOf(cp.cat) < 0) cp.cat = 'all';
        cpBar.innerHTML =
            '<div class="pp-filters-row">' +
            '<label>' + es(t('类型', 'Type')) + '<select id="cpCat"><option value="all">' + es(t('全部', 'All')) + '</option>' +
            cats.map(function (c) {
                return '<option value="' + es(c) + '"' + (cp.cat === c ? ' selected' : '') + '>' + es(catLabel(c)) + '</option>';
            }).join('') + '</select></label>' +
            '<label>' + es(t('语言', 'Language')) + '<select id="cpLang">' +
            [['all', '不限', 'Any'], ['zh', '中文', 'Chinese'], ['en', '英文', 'English'], ['bi', '中英双语', 'Bilingual']].map(function (o) {
                return '<option value="' + o[0] + '"' + (cp.lang === o[0] ? ' selected' : '') + '>' + es(t(o[1], o[2])) + '</option>';
            }).join('') + '</select></label>' +
            '<label>' + es(t('排序', 'Sort')) + '<select id="cpSort">' +
            [['default', '默认', 'Default'], ['newest', '最新', 'Newest'], ['title', '书名', 'Title'], ['author', '作者', 'Author']].map(function (o) {
                return '<option value="' + o[0] + '"' + (cp.sort === o[0] ? ' selected' : '') + '>' + es(t(o[1], o[2])) + '</option>';
            }).join('') + '</select></label>' +
            '<label class="pp-check"><input type="checkbox" id="cpFavOnly"' + (cp.favOnly ? ' checked' : '') + '> ' + es(t('仅看收藏', 'Favorites only')) + '</label>' +
            '<span class="pp-count" id="cpCount"></span></div>';
        el('cpCat').onchange = function () { cp.cat = this.value; decorateCommunity(); };
        el('cpLang').onchange = function () { cp.lang = this.value; decorateCommunity(); };
        el('cpSort').onchange = function () { cp.sort = this.value; decorateCommunity(); };
        el('cpFavOnly').onchange = function () { cp.favOnly = this.checked; decorateCommunity(); };
    }
    function cpMatch(c) {
        if (cp.cat !== 'all' && c.dataset.cat !== cp.cat) return false;
        if (cp.favOnly && !isFavorite(c.dataset.bookId)) return false;
        var langs = c.dataset.langs || '';
        if (cp.lang === 'zh' && langs.indexOf('zh') < 0) return false;
        if (cp.lang === 'en' && langs.indexOf('en') < 0) return false;
        if (cp.lang === 'bi' && langs !== 'zh,en') return false;
        return true;
    }
    function enhanceCommunityCard(c) {
        var id = c.dataset.bookId || '', cat = c.dataset.cat || '';
        var title = (c.querySelector('.book-title') || {}).textContent || '';
        var desc = c.dataset.desc || '', icon = c.dataset.icon || '📖';
        var cover = c.querySelector('.book-cover');
        if (cover) {
            cover.className = 'book-cover pp-cover';
            cover.style.background = coverBg(desc + '|' + id);
            cover.innerHTML = '<span class="pp-cover-icon">' + es(icon) + '</span>' +
                '<span class="pp-cover-initial">' + es(initialOf(title, desc)) + '</span>';
        }
        var extras = node('div', 'pp-card-extra');
        extras.innerHTML = '<div class="pp-card-desc">' + es(desc) + '</div>' +
            '<div class="pp-card-meta"><span class="ll-badge">' + es(catLabel(cat)) + '</span>' +
            (c.dataset.langs === 'zh,en' ? '<span class="ll-badge">中 / EN</span>' : '') + '</div>' +
            '<div class="pp-card-actions">' +
            '<button type="button" class="pp-mini" data-pp-fav="' + es(id) + '"></button>' +
            '<button type="button" class="pp-mini" data-pp-state="' + es(id) + '"></button>' +
            '</div>';
        c.appendChild(extras);
        c.querySelector('[data-pp-fav]').addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            toggleFavorite(id, title, decorateCommunity);
        });
        c.querySelector('[data-pp-state]').addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            cycleStatus(id, decorateCommunity);
        });
        c.dataset.ppDone = '1';
    }
    var cpCatsKey = null;
    function decorateCommunity() {
        if (!cpGrid) return;
        /* books.json 异步返回后分类才出现，这里重建一次筛选条 */
        var catsNow = cpCats().join('|');
        if (catsNow !== cpCatsKey) { cpCatsKey = catsNow; renderCpFilters(); }
        var cards = Array.prototype.slice.call(cpGrid.querySelectorAll('.book-card'));
        if (!cards.length) { if (cpEmpty) cpEmpty.hidden = true; return; }
        var kw = ((cpSearch && cpSearch.value) || '').trim().toLowerCase();
        cards.forEach(function (c) {
            if (!c.dataset.ppDone) enhanceCommunityCard(c);
            highlight(c.querySelector('.book-title'), kw);
            highlight(c.querySelector('.book-author'), kw);
            var favBtn = c.querySelector('[data-pp-fav]');
            var stateBtn = c.querySelector('[data-pp-state]');
            var fav = isFavorite(c.dataset.bookId);
            if (favBtn) {
                favBtn.textContent = fav ? '★ ' + t('已收藏', 'Saved') : '☆ ' + t('收藏', 'Save');
                favBtn.classList.toggle('on', fav);
            }
            if (stateBtn) {
                var st = obj('shelf_status')[c.dataset.bookId] || '';
                stateBtn.textContent = st ? '● ' + statusLabel(st) : '○ ' + t('标记', 'Mark');
                stateBtn.classList.toggle('on', !!st);
            }
            c.hidden = !cpMatch(c);
            c.style.order = '';
        });
        var visible = cards.filter(function (c) { return !c.hidden; });
        if (cp.sort === 'newest') visible.sort(function (a, b) { return (Number(b.dataset.sort) || 0) - (Number(a.dataset.sort) || 0); });
        else if (cp.sort === 'title') visible.sort(function (a, b) {
            return (a.querySelector('.book-title').textContent || '').localeCompare(b.querySelector('.book-title').textContent || '');
        });
        else if (cp.sort === 'author') visible.sort(function (a, b) {
            return (a.dataset.author || '').localeCompare(b.dataset.author || '');
        });
        if (cp.sort !== 'default') visible.forEach(function (c, i) { c.style.order = i; });
        if (cpEmpty) {
            cpEmpty.hidden = visible.length > 0;
            cpEmpty.textContent = t('没有符合筛选条件的书籍，试试清除筛选项。', 'No books match. Try clearing the filters.');
        }
        var count = el('cpCount');
        if (count) count.textContent = visible.length + ' / ' + cards.length + ' ' + t('本', 'books');
    }
    function initCommunity() {
        cpGrid = el('bookGrid'); cpSearch = el('searchInput');
        if (!cpGrid || !cpSearch || !/data\/community\//.test(location.pathname)) return;
        cpBar = node('div', 'pp-filters'); cpBar.id = 'cpFilters';
        cpSearch.parentNode.appendChild(cpBar);
        cpEmpty = node('div', 'pp-empty'); cpEmpty.id = 'cpEmpty'; cpEmpty.hidden = true;
        cpGrid.parentNode.appendChild(cpEmpty);
        renderCpFilters();
        observe(cpGrid, decorateCommunity);
        var re = null;
        cpSearch.addEventListener('input', function () {
            clearTimeout(re); re = setTimeout(decorateCommunity, 120);
        });
        onLang(function () { renderCpFilters(); decorateCommunity(); });
        onStore(['favorites', 'shelf_status', 'recent', 'backupImported'], decorateCommunity);
        Bus.on('backupImported', function () { renderCpFilters(); decorateCommunity(); });
        decorateCommunity();
        cmd({ id: 'cp-all', zh: '共创书库：清除筛选', en: 'Community: clear filters', icon: '❖', section: 'Community', run: function () {
            cp = { cat: 'all', lang: 'all', sort: 'default', favOnly: false };
            renderCpFilters(); decorateCommunity();
        } });
        cmd({ id: 'cp-fav', zh: '共创书库：仅看收藏', en: 'Community: favorites only', icon: '★', section: 'Community', keywords: 'favorite 收藏', run: function () {
            cp.favOnly = !cp.favOnly; renderCpFilters(); decorateCommunity();
        } });
    }

    /* ========================================================
       2. 作者面板：认证进度、本地写作统计、投稿本地状态标记、
          推荐到首页的本地标记；保留 Tally iframe 与侧栏入口
       ======================================================== */
    var dpMain = null;
    var FLAGS = [['', '未标记', 'Unmarked'], ['following', '跟进中', 'Following'],
        ['accepted', '已收录', 'Accepted'], ['revise', '需修改', 'Needs revision'], ['withdrawn', '已撤回', 'Withdrawn']];
    function flagLabel(code) {
        var f = FLAGS.filter(function (x) { return x[0] === code; })[0];
        return f ? t(f[1], f[2]) : t('未标记', 'Unmarked');
    }
    function currentPanel() {
        var b = doc.querySelector('#dashSide button.active');
        return b ? b.dataset.panel : 'overview';
    }
    function dashStats() {
        var nums = [];
        Array.prototype.forEach.call(dpMain.querySelectorAll('.dash-stat b'), function (b) {
            nums.push(parseInt((b.textContent || '').replace(/[^\d]/g, ''), 10) || 0);
        });
        return { works: nums[0] || 0, submissions: nums[1] || 0, approved: nums[2] || 0, level: nums[3] || 1 };
    }
    function addProgressCard() {
        if (el('ppProgress')) return;
        var panel = dpMain.querySelector('.dash-panel');
        if (!panel) return;
        var s = dashStats();
        var hint = dpMain.querySelector('.read-hint');
        var isAuthor = /身份：作者|Role: Author|作者 ID|Author ID/.test((hint && hint.textContent) || '');
        var steps = [
            { ok: true, zh: '登录账号', en: 'Signed in' },
            { ok: isAuthor, zh: '成为作者', en: 'Become an author' },
            { ok: s.works > 0, zh: '有作品上架', en: 'Publish a work' },
            { ok: s.approved > 0, zh: '投稿通过', en: 'Approved submission' }
        ];
        var got = steps.filter(function (x) { return x.ok; }).length;
        var card = node('div', 'pp-card pp-progress-card');
        card.id = 'ppProgress';
        card.innerHTML = '<div class="ll-section-title">🏅 ' + es(t('作者成长进度', 'Author progress')) +
            '<span class="ll-badge">' + got + ' / ' + steps.length + '</span></div>' +
            '<div class="ll-progress"><span style="width:' + (got / steps.length * 100) + '%"></span></div>' +
            '<div class="pp-steps">' + steps.map(function (x) {
                return '<span class="pp-step' + (x.ok ? ' ok' : '') + '">' + (x.ok ? '✔' : '○') + ' ' + es(t(x.zh, x.en)) + '</span>';
            }).join('') + '</div>' +
            '<p class="ll-note">' + es(t('认证等级与官方标识由编辑团队审核，这里只展示本地可见的进度。', 'Levels and official badges are set by editors; this card only reflects locally visible progress.')) + '</p>' +
            '<div class="pp-kv"><span>' + es(t('近 7 天码字', 'Words in 7 days')) + '</span><b>' + recentWords(7) + '</b>' +
            '<span>' + es(t('已推荐到首页', 'Featured locally')) + '</span><b>' + arr('home_recommend').length + '</b>' +
            '<span>' + es(t('本地存储', 'Local storage')) + '</span><b>' + es((Store.usage().used / 1024).toFixed(1) + ' KB') + '</b></div>' +
            '<div class="ll-row"><a class="rd-btn primary" href="draft.html">' + es(t('打开写作台', 'Open writing desk')) + '</a>' +
            backupBtn('ppBackup') + '</div>';
        panel.appendChild(card);
        bindBackup('ppBackup');
    }
    function decorateWorks() {
        if (el('ppWorksBar')) return;
        var panel = dpMain.querySelector('.dash-panel');
        if (!panel) return;
        var recs = arr('home_recommend');
        var bar = node('div', 'pp-inline-bar');
        bar.id = 'ppWorksBar';
        bar.innerHTML = '<span class="ll-badge">★ ' + recs.length + ' ' + es(t('本已标记推荐（仅本机）', 'featured locally')) + '</span>' +
            '<a class="rd-btn" href="index.html">' + es(t('查看首页', 'View homepage')) + '</a>' + backupBtn('ppWorksBackup');
        panel.insertBefore(bar, panel.querySelector('.dash-list'));
        bindBackup('ppWorksBackup');
        Array.prototype.forEach.call(panel.querySelectorAll('.dash-item'), function (item) {
            var link = item.querySelector('a[href]');
            var id = bookIdFromHref(link ? link.getAttribute('href') : '');
            if (!id || item.querySelector('[data-pp-rec]')) return;
            var titleEl = item.querySelector('.title');
            var title = (titleEl && titleEl.textContent || '').trim();
            var wrap = node('div', 'pp-item-actions');
            var b = node('button', 'pp-mini');
            b.type = 'button';
            b.dataset.ppRec = id;
            b.addEventListener('click', function () {
                var list = arr('home_recommend'), at = -1;
                list.forEach(function (r, i) { if (r && r.id === id) at = i; });
                if (at >= 0) list.splice(at, 1); else list.unshift({ id: id, title: title, ts: Date.now() });
                Store.set('home_recommend', list);
                toast(at >= 0 ? t('已取消推荐标记', 'Removed local feature') : t('已标记推荐（仅本机可见）', 'Featured locally'));
                el('ppWorksBar').remove(); decorateWorks();
            });
            wrap.appendChild(b);
            item.appendChild(wrap);
        });
        refreshRecButtons();
    }
    function refreshRecButtons() {
        var recs = arr('home_recommend');
        Array.prototype.forEach.call(dpMain.querySelectorAll('[data-pp-rec]'), function (b) {
            var on = recs.some(function (r) { return r && r.id === b.dataset.ppRec; });
            b.textContent = on ? '★ ' + t('已推荐', 'Featured') : '☆ ' + t('推荐到首页', 'Feature');
            b.classList.toggle('on', on);
        });
    }
    function decorateSubmissions() {
        if (el('ppSubBar')) return;
        var panel = dpMain.querySelector('.dash-panel');
        if (!panel) return;
        var flags = obj('submission_flags');
        var counts = {};
        Object.keys(flags).forEach(function (k) { counts[flags[k]] = (counts[flags[k]] || 0) + 1; });
        var bar = node('div', 'pp-inline-bar');
        bar.id = 'ppSubBar';
        bar.innerHTML = '<span class="pp-count">' + es(t('本地状态标记（不上传服务器）', 'Local flags (never uploaded)')) + '</span>' +
            FLAGS.slice(1).map(function (f) {
                return '<span class="ll-badge">' + es(t(f[1], f[2])) + ' ' + (counts[f[0]] || 0) + '</span>';
            }).join('');
        var heading = Array.prototype.slice.call(panel.querySelectorAll('h3')).filter(function (h) {
            return /我的投稿|My submissions/.test(h.textContent);
        })[0];
        if (heading) panel.insertBefore(bar, heading.nextSibling);
        else panel.appendChild(bar);
        Array.prototype.forEach.call(panel.querySelectorAll('.dash-item'), function (item) {
            var del = item.querySelector('[data-del]');
            if (!del) return;
            var id = del.dataset.del;
            var existing = item.querySelector('[data-pp-flag]');
            if (existing) { existing.value = flags[id] || ''; return; }
            var sel = node('select', 'pp-flag');
            sel.dataset.ppFlag = id;
            sel.setAttribute('aria-label', t('投稿本地状态', 'Local submission status'));
            sel.innerHTML = FLAGS.map(function (f) {
                return '<option value="' + f[0] + '"' + ((flags[id] || '') === f[0] ? ' selected' : '') + '>' + es(t(f[1], f[2])) + '</option>';
            }).join('');
            sel.addEventListener('change', function () {
                var all = obj('submission_flags');
                if (sel.value) all[id] = sel.value; else delete all[id];
                Store.set('submission_flags', all);
                toast(t('本地状态已更新', 'Local flag updated'));
                el('ppSubBar').remove(); decorateSubmissions();
            });
            var holder = del.parentNode;
            holder.insertBefore(sel, del);
        });
    }
    function decorateDashboard() {
        if (!dpMain) return;
        var panel = currentPanel();
        if (panel === 'overview' || panel === 'cert') addProgressCard();
        else if (panel === 'works') decorateWorks();
        else if (panel === 'submissions') decorateSubmissions();
        refreshRecButtons();
    }
    function resetDash() {
        ['ppProgress', 'ppWorksBar', 'ppSubBar'].forEach(function (id) {
            var n = el(id);
            if (n) n.remove();
        });
        decorateDashboard();
    }
    function gotoPanel(name) {
        var b = doc.querySelector('#dashSide button[data-panel="' + name + '"]');
        if (b) b.click();
    }
    function initDashboard() {
        dpMain = el('dashMain');
        if (!dpMain) return;
        observe(dpMain, decorateDashboard);
        onStore(['home_recommend', 'submission_flags', 'daily'], resetDash);
        Bus.on('backupImported', resetDash);
        decorateDashboard();
        cmd({ id: 'dp-works', zh: '作者面板：我的作品', en: 'Dashboard: my works', icon: '📚', section: 'Dashboard', run: function () { gotoPanel('works'); } });
        cmd({ id: 'dp-sub', zh: '作者面板：共创投稿', en: 'Dashboard: submissions', icon: '📝', section: 'Dashboard', run: function () { gotoPanel('submissions'); } });
        cmd({ id: 'dp-cert', zh: '作者面板：认证进度', en: 'Dashboard: certification', icon: '🏅', section: 'Dashboard', run: function () { gotoPanel('overview'); } });
    }

    /* ========================================================
       3. 作者主页：作品聚合统计、分类筛选、排序、收藏、分享
       ======================================================== */
    var ap = { cat: 'all', sort: 'default', favOnly: false };
    var apGrid = null, apSummary = null, apFilters = null, apEmpty = null;
    function authorId() {
        var m = /[?&]id=([^&#]+)/.exec(location.search);
        if (!m) return '';
        try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    function apCats() {
        var seen = {};
        Array.prototype.forEach.call(apGrid.querySelectorAll('.book-card'), function (c) {
            if (c.dataset.cat) seen[c.dataset.cat] = 1;
        });
        return Object.keys(seen).sort();
    }
    function renderApChrome() {
        if (!apSummary) return;
        var name = (el('authorName') || {}).textContent || authorId() || '';
        var works = apGrid.querySelectorAll('.book-card').length;
        var cats = apCats().length;
        var community = apGrid.querySelectorAll('.book-card[data-kind="community"]').length;
        apSummary.innerHTML = '<div class="pp-stat-row">' +
            '<div class="pp-stat"><b>' + works + '</b><span>' + es(t('作品', 'Works')) + '</span></div>' +
            '<div class="pp-stat"><b>' + cats + '</b><span>' + es(t('分类', 'Categories')) + '</span></div>' +
            '<div class="pp-stat"><b>' + community + '</b><span>' + es(t('共创作品', 'Community')) + '</span></div>' +
            '<div class="pp-stat"><b>' + arr('favorites').length + '</b><span>' + es(t('本机收藏', 'Saved')) + '</span></div>' +
            '</div><div class="ll-row"><button type="button" class="rd-btn" id="apShare">' + es(t('复制主页链接', 'Copy page link')) + '</button>' +
            '<a class="rd-btn" href="data/community/index.html">' + es(t('共创书库', 'Community library')) + '</a></div>' +
            '<p class="ll-note">' + es(t('作品来自站内书库与共创书库，按作者标识自动汇总。', 'Works are aggregated from the main and community libraries by author ID.')) + '</p>';
        el('apShare').onclick = function () {
            var url = location.href;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url).then(function () { toast(t('链接已复制', 'Link copied')); }, function () { toast(url); });
                } else { toast(url); }
            } catch (e) { toast(url); }
        };
        if (!apFilters) return;
        apFilters.innerHTML = '<div class="pp-chip-row">' +
            ['all'].concat(apCats()).map(function (c) {
                return '<button type="button" class="ll-chip' + (ap.cat === c ? ' active' : '') + '" data-cat="' + es(c) + '">' + es(catLabel(c)) + '</button>';
            }).join('') + '</div>' +
            '<div class="pp-filters-row"><label>' + es(t('排序', 'Sort')) + '<select id="apSort">' +
            [['default', '默认', 'Default'], ['title', '书名', 'Title'], ['cat', '分类', 'Category']].map(function (o) {
                return '<option value="' + o[0] + '"' + (ap.sort === o[0] ? ' selected' : '') + '>' + es(t(o[1], o[2])) + '</option>';
            }).join('') + '</select></label>' +
            '<label class="pp-check"><input type="checkbox" id="apFavOnly"' + (ap.favOnly ? ' checked' : '') + '> ' + es(t('仅看收藏', 'Favorites only')) + '</label>' +
            '<span class="pp-count" id="apCount"></span></div>';
        Array.prototype.forEach.call(apFilters.querySelectorAll('[data-cat]'), function (b) {
            b.onclick = function () { ap.cat = b.dataset.cat; renderApChrome(); decorateAuthor(); };
        });
        el('apSort').onchange = function () { ap.sort = this.value; decorateAuthor(); };
        el('apFavOnly').onchange = function () { ap.favOnly = this.checked; decorateAuthor(); };
    }
    function enhanceAuthorCard(c) {
        var id = c.dataset.bookId || '';
        var icon = c.querySelector('.book-icon');
        if (icon) {
            icon.classList.add('pp-icon');
            icon.style.background = coverBg(id || (c.querySelector('h3') || {}).textContent);
        }
        var meta = node('div', 'pp-card-meta');
        meta.innerHTML = '<span class="ll-badge">' + es(catLabel(c.dataset.cat)) + '</span>' +
            '<span class="ll-badge">' + (c.dataset.kind === 'community' ? es(t('共创', 'Community')) : es(t('站内', 'Library'))) + '</span>';
        var info = c.querySelector('.book-info');
        if (info) info.appendChild(meta);
        var fav = node('button', 'pp-mini pp-fav-corner');
        fav.type = 'button';
        fav.dataset.ppFav = id;
        fav.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            var title = (c.querySelector('h3') || {}).textContent || '';
            toggleFavorite(id, title, decorateAuthor);
        });
        c.appendChild(fav);
        c.dataset.ppDone = '1';
    }
    function decorateAuthor() {
        if (!apGrid) return;
        var cards = Array.prototype.slice.call(apGrid.querySelectorAll('.book-card'));
        cards.forEach(function (c) {
            if (!c.dataset.ppDone) enhanceAuthorCard(c);
            var favBtn = c.querySelector('[data-pp-fav]');
            var on = isFavorite(c.dataset.bookId);
            if (favBtn) {
                favBtn.textContent = on ? '★' : '☆';
                favBtn.title = on ? t('取消收藏', 'Remove favorite') : t('加入收藏', 'Add favorite');
                favBtn.classList.toggle('on', on);
            }
            c.hidden = !((ap.cat === 'all' || c.dataset.cat === ap.cat) && (!ap.favOnly || on));
            c.style.order = '';
        });
        var visible = cards.filter(function (c) { return !c.hidden; });
        if (ap.sort === 'title') visible.sort(function (a, b) {
            return ((a.querySelector('h3') || {}).textContent || '').localeCompare((b.querySelector('h3') || {}).textContent || '');
        });
        else if (ap.sort === 'cat') visible.sort(function (a, b) {
            return (a.dataset.cat || '').localeCompare(b.dataset.cat || '');
        });
        if (ap.sort !== 'default') visible.forEach(function (c, i) { c.style.order = i; });
        if (apEmpty) {
            apEmpty.hidden = visible.length > 0 || !cards.length;
            apEmpty.textContent = t('没有符合筛选条件的作品。', 'No works match these filters.');
        }
        var count = el('apCount');
        if (count) count.textContent = visible.length + ' / ' + cards.length + ' ' + t('本', 'works');
    }
    function initAuthor() {
        apGrid = el('worksGrid');
        if (!apGrid || !el('authorHero')) return;
        var section = apGrid.parentNode;
        apSummary = node('section', 'pp-card'); apSummary.id = 'apSummary';
        apFilters = node('div', 'pp-filters'); apFilters.id = 'apFilters';
        apEmpty = node('div', 'pp-empty'); apEmpty.id = 'apEmpty'; apEmpty.hidden = true;
        section.insertBefore(apSummary, section.querySelector('.works-title'));
        section.insertBefore(apFilters, apGrid);
        section.appendChild(apEmpty);
        observe(apGrid, function () { renderApChrome(); decorateAuthor(); });
        onLang(function () { renderApChrome(); decorateAuthor(); });
        onStore(['favorites', 'shelf_status', 'backupImported'], decorateAuthor);
        Bus.on('backupImported', function () { renderApChrome(); decorateAuthor(); });
        renderApChrome(); decorateAuthor();
        cmd({ id: 'ap-share', zh: '复制作者主页链接', en: 'Copy author page link', icon: '🔗', section: 'Author', run: function () {
            var b = el('apShare'); if (b) b.click();
        } });
    }

    /* ========================================================
       4. 关于页：版本信息、本地存储用量、数据备份入口、功能总览
       ======================================================== */
    var FEATURES = [
        { icon: '▤', zh: '阅读体验', en: 'Reading', items: [
            ['进度与剩余时间', 'Progress & time left'], ['书内全文搜索', 'Search inside a book'],
            ['打字机 / 翻页双模式', 'Typewriter & paging modes'], ['语音朗读与听书', 'Read-aloud & listening'],
            ['护眼主题与排版滑块', 'Eye-care themes & typography'], ['键盘、手势与常亮', 'Keys, gestures & wake lock']
        ] },
        { icon: '🖍️', zh: '笔记与记忆', en: 'Notes & memory', items: [
            ['多色多线型划线', 'Multi-color highlights'], ['命名书签与批注', 'Named bookmarks & notes'],
            ['笔记搜索与导出', 'Note search & export'], ['引用卡片与带出处复制', 'Quote cards & cited copy'],
            ['回到上次位置', 'Resume reading'], ['X-Ray 词条索引', 'X-Ray term index']
        ] },
        { icon: '📚', zh: '首页书架', en: 'Bookshelf', items: [
            ['分类、作者与收藏夹筛选', 'Category, author & folder filters'], ['拖拽排序与搜索高亮', 'Drag sorting & search highlight'],
            ['日历热力图与时长柱状图', 'Heatmap & reading bars'], ['连续打卡与成就勋章', 'Streaks & achievements'],
            ['阅读状态与猜你喜欢', 'Reading status & recommendations'], ['随时间问候', 'Time-aware greeting']
        ] },
        { icon: '✍️', zh: '写作台', en: 'Writing desk', items: [
            ['多草稿与分卷章节树', 'Multiple drafts & volume tree'], ['大纲 / 人物卡 / 设定集', 'Outline, characters & lore'],
            ['版本快照与回收站', 'Version snapshots & trash'], ['查找替换与自动取名', 'Find & replace, name generator'],
            ['字数目标环与日更曲线', 'Word goal ring & daily curve'], ['专注模式、导入 MD 与投稿预填', 'Focus, Markdown import & prefill']
        ] },
        { icon: '❖', zh: '社区与作者', en: 'Community & authors', items: [
            ['共创书库多维筛选', 'Community filters'], ['渐变封面（本地生成）', 'Locally generated covers'],
            ['作者聚合主页', 'Aggregated author page'], ['投稿本地状态标记', 'Local submission flags'],
            ['推荐到首页的本地标记', 'Local homepage feature flags'], ['作者成长进度', 'Author progress']
        ] },
        { icon: '⚙️', zh: '通用能力', en: 'Global', items: [
            ['Ctrl/⌘+K 命令面板', 'Command palette'], ['快捷键帮助与撤销', 'Shortcut help & undo'],
            ['数据备份与迁移', 'Backup & migration'], ['跨标签同步与存储用量', 'Cross-tab sync & usage'],
            ['暗色跟随与减少动画', 'System dark mode & reduced motion'], ['懒加载与焦点可见', 'Lazy loading & focus rings']
        ] }
    ];
    function featureHtml() {
        return '<div class="pp-feature-grid">' + FEATURES.map(function (g) {
            return '<section class="pp-feature"><h4>' + g.icon + ' ' + es(t(g.zh, g.en)) + '</h4><ul>' +
                g.items.map(function (i) { return '<li>' + es(t(i[0], i[1])) + '</li>'; }).join('') +
                '</ul></section>';
        }).join('') + '</div>';
    }
    function renderAboutBox() {
        var box = el('aboutVersionBox');
        if (!box) return;
        box.innerHTML = '<div class="pp-version-row"><span class="ll-badge new">v' + es(UI.VERSION) + '</span>' +
            '<span class="ll-muted">' + es(t('本次更新：2026-11', 'Updated: Nov 2026')) + '</span>' +
            '<span class="ll-muted">' + es(t('纯静态 · 无框架 · 无构建', 'Static · No framework · No build')) + '</span></div>' +
            '<p class="ll-note">' + es(t('这次一口气补齐了阅读、笔记、书架、写作台、社区与全局能力共 90 项前端功能。所有数据只保存在你自己的浏览器里，本站不上传、不追踪阅读内容。', 'This release adds 90 front-end features across reading, notes, bookshelf, writing, community and global tools. All data stays in your own browser; reading content is never uploaded or tracked.')) + '</p>' +
            '<h4>' + es(t('本地数据', 'Local data')) + '</h4>' + usageBlock() +
            '<div class="ll-row">' + backupBtn('abBackup') +
            '<a class="rd-btn" href="docs.html">' + es(t('查看数据说明', 'Data documentation')) + '</a></div>' +
            '<h4>' + es(t('功能总览', 'Feature overview')) + '</h4>' + featureHtml() +
            '<h4>' + es(t('能力边界', 'Scope')) + '</h4>' +
            '<p class="ll-note">' + es(t('不做生词本、不做 PWA 离线、不做 AI 生图，也不接入任何需要密钥或服务端代理的外部服务；云端登录、投稿与作者资料仍沿用原有服务，本轮未改动后端。', 'No vocabulary notebook, no offline PWA, no AI image generation, and no service requiring an API key or server proxy. Sign-in, submissions and author profiles keep using the existing backend, which this release does not change.')) + '</p>';
        bindBackup('abBackup');
    }
    function initAbout() {
        if (!el('aboutVersionBox')) return;
        renderAboutBox();
        onLang(renderAboutBox);
        Bus.on('backupImported', renderAboutBox);
        cmd({ id: 'ab-backup', zh: '关于页：数据备份', en: 'About: data backup', icon: '⇩', section: 'About', run: function () { UI.openBackup(); } });
    }

    /* ========================================================
       5. 文档页：键类别清单、用量、备份迁移与快捷键说明
       ======================================================== */
    var KEY_GROUPS = [
        ['偏好 Preferences', 'reader_prefs / notes_prefs / theme / fontSize', ['排版、护眼主题、朗读与笔记偏好', 'Typography, eye-care themes, read-aloud and note preferences']],
        ['进度与笔记 Progress', 'progress_* / notes_* / recent / favorites / stats', ['断点续读、高亮批注、书签、收藏与累计时长', 'Resume position, highlights, notes, bookmarks, favorites and total time']],
        ['统计与书架 Stats', 'daily / shelf_status / shelf_order / shelf_folders', ['按天聚合的阅读与码字数据、状态、排序与收藏夹', 'Daily reading/writing aggregates, status, order and folders']],
        ['写作台 Writing desk', 'dp_library_* / dp_versions_* / dp_trash_*', ['多草稿、版本快照与回收站（按作者 ID 区分）', 'Multiple drafts, snapshots and trash (scoped by author ID)']],
        ['页面状态 Page state', 'home_recommend / submission_flags', ['推荐与投稿状态仅为本机标记，不上传服务器', 'Local-only feature and submission flags, never uploaded']],
        ['备份 Backup', 'lelele-read-backup-YYYY-MM-DD.json', ['手动导出的 JSON 文件，可合并或替换恢复', 'Manually exported JSON, restored by merge or replace']]
    ];
    function renderDocsBox() {
        var box = el('docsDataBox');
        if (!box) return;
        box.innerHTML = '<div class="pp-key-table"><table class="ll-table">' +
            '<thead><tr><th>' + es(t('类别', 'Group')) + '</th><th>' + es(t('键名示例', 'Keys')) + '</th><th>' + es(t('用途', 'Purpose')) + '</th></tr></thead><tbody>' +
            KEY_GROUPS.map(function (g) {
                return '<tr><td>' + es(g[0]) + '</td><td><code>' + es(g[1]) + '</code></td><td>' + es(t(g[2][0], g[2][1])) + '</td></tr>';
            }).join('') + '</tbody></table></div>' +
            '<h4>' + es(t('备份与迁移', 'Backup & migration')) + '</h4>' + usageBlock() +
            '<div class="ll-row">' + backupBtn('dcBackup') +
            '<a class="rd-btn" href="about.html">' + es(t('版本与功能总览', 'Version & features')) + '</a></div>' +
            '<p class="ll-note">' + es(t('导入备份时可选择「合并」或「替换」；会话与登录态不会被导出。按 Ctrl/⌘+K 打开命令面板，按 ? 查看全部快捷键。', 'Import supports merge or replace; sessions and sign-in state are excluded. Press Ctrl/⌘+K for the command palette and ? for all shortcuts.')) + '</p>';
        bindBackup('dcBackup');
    }
    function initDocs() {
        if (!el('docsDataBox')) return;
        renderDocsBox();
        onLang(renderDocsBox);
        Bus.on('backupImported', renderDocsBox);
        cmd({ id: 'dc-backup', zh: '文档：数据备份与迁移', en: 'Docs: backup & migration', icon: '⇩', section: 'Docs', run: function () { UI.openBackup(); } });
    }

    function init() {
        try { initCommunity(); } catch (e) { warn('community', e); }
        try { initDashboard(); } catch (e) { warn('dashboard', e); }
        try { initAuthor(); } catch (e) { warn('author', e); }
        try { initAbout(); } catch (e) { warn('about', e); }
        try { initDocs(); } catch (e) { warn('docs', e); }
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
})();
