/* ============================================================
   notice.js — 每日一次公告 + 主页「查看公告」入口 + 完整公告列表
   由 common-ui.js 全站动态加载；无公告则完全不出现。
   ============================================================ */
(function () {
    'use strict';
    var doc = document, win = window;
    var L = win.Lelele, Store = L && L.Store, UI = L && L.UI;
    var base = /\/data\/community\//.test(location.pathname) ? '../../' : '';
    var isHome = /(^|\/)index\.html?$/.test(location.pathname) || location.pathname === '/';
    var SHOWN_KEY = 'notice_shown';
    var list = [], active = 0, daily = null, listBox = null, btn = null;

    function t(zh, en) { return L ? L.t(zh, en) : zh; }
    function es(s) { return L ? L.esc(s == null ? '' : s) : String(s == null ? '' : s); }
    function make(tag, cls, html) {
        var n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (html != null) n.innerHTML = html;
        return n;
    }
    function lang() { return doc.documentElement.getAttribute('data-lang') || 'zh'; }
    function dayKey() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function today() { return dayKey(); }
    function titleOf(a) { return lang() === 'en' ? (a.title_en || a.title_zh) : (a.title_zh || a.title_en); }
    function bodyOf(a) { return lang() === 'en' ? (a.content_en || a.content_zh) : (a.content_zh || a.content_en); }
    function valid(a) {
        if (!a || !a.id) return false;
        var d = today();
        if (a.publishDate && a.publishDate > d) return false;
        if (a.expireDate && a.expireDate < d) return false;
        return true;
    }
    function textHtml(s) { return es(s || '').replace(/\n/g, '<br>'); }

    /* ---------- 每日一次的最新公告 ---------- */
    function buildDaily() {
        if (daily) daily.remove();
        daily = make('div', 'll-overlay nt-daily');
        daily.id = 'ntDaily';
        daily.hidden = true;
        daily.innerHTML =
            '<div class="ll-panel"><div class="ll-panel-head nt-panel-head">' +
            '<h3><span class="zh-inline">📢 最新公告</span><span class="en-inline">📢 Latest announcement</span></h3>' +
            '<button type="button" class="nt-x" data-nt-close-daily aria-label="Close">×</button></div>' +
            '<div class="ll-panel-body"><div class="nt-hero ll-winter-banner-bg" id="ntDailyHero"></div>' +
            '<div class="nt-body" id="ntDailyBody"></div>' +
            '<div class="nt-foot">' +
            '<button type="button" class="rd-btn" id="ntDailyAll"><span class="zh-inline">查看全部公告</span><span class="en-inline">View all announcements</span></button>' +
            '<button type="button" class="rd-btn primary" data-nt-close-daily><span class="zh-inline">知道了</span><span class="en-inline">Got it</span></button>' +
            '</div></div></div>';
        doc.body.appendChild(daily);
        daily.addEventListener('click', function (e) {
            if (e.target === daily || (e.target.closest && e.target.closest('[data-nt-close-daily]'))) closeDaily();
        });
        var all = daily.querySelector('#ntDailyAll');
        if (all) all.onclick = function () { closeDaily(); openList(); };
    }
    function renderDaily() {
        if (!daily || !list.length) return;
        var a = list[0];
        daily.querySelector('#ntDailyHero').innerHTML =
            '<h3>' + es(titleOf(a)) + '</h3><time>' + es(a.publishDate || '') + '</time>';
        daily.querySelector('#ntDailyBody').innerHTML = textHtml(bodyOf(a));
    }
    function showDaily() {
        if (!list.length || !daily) return;
        var mark = today() + ':' + list[0].id;
        if (Store && Store.get(SHOWN_KEY, '') === mark) return;
        renderDaily();
        daily.hidden = false;
        if (Store) Store.set(SHOWN_KEY, mark);
    }
    function closeDaily() { if (daily) daily.hidden = true; }

    /* ---------- 完整公告列表（与了了了游「查看更多」一致） ---------- */
    function buildList() {
        if (listBox) listBox.remove();
        listBox = make('div', 'll-overlay nt-list');
        listBox.id = 'ntList';
        listBox.hidden = true;
        listBox.innerHTML =
            '<div class="ll-panel" style="max-width:860px"><div class="ll-panel-head nt-panel-head">' +
            '<h3><span class="zh-inline">📢 全部公告</span><span class="en-inline">📢 All announcements</span></h3>' +
            '<button type="button" class="nt-x" data-nt-close-list aria-label="Close">×</button></div>' +
            '<div class="ll-panel-body"><div class="nt-box">' +
            '<div class="nt-sidebar" id="ntSidebar"></div>' +
            '<div class="nt-content" id="ntContent"></div></div></div></div>';
        doc.body.appendChild(listBox);
        listBox.addEventListener('click', function (e) {
            if (e.target === listBox || (e.target.closest && e.target.closest('[data-nt-close-list]'))) listBox.hidden = true;
        });
    }
    function renderList() {
        if (!listBox) return;
        var side = listBox.querySelector('#ntSidebar'), body = listBox.querySelector('#ntContent');
        if (!list.length) {
            side.innerHTML = '<div class="nt-loading">' + es(t('暂无公告', 'No announcements')) + '</div>';
            body.innerHTML = '';
            return;
        }
        if (active >= list.length) active = 0;
        side.innerHTML = list.map(function (a, i) {
            return '<div class="nt-item' + (i === active ? ' active' : '') + '" data-nt-i="' + i + '">' +
                '<span class="nt-item-title">' + es(titleOf(a)) + '</span>' +
                '<span class="nt-item-date">' + es(a.publishDate || '') + '</span></div>';
        }).join('');
        var a = list[active];
        body.innerHTML = '<h4>' + es(titleOf(a)) + '<span class="date">' + es(a.publishDate || '') + '</span></h4>' +
            '<div class="nt-text">' + textHtml(bodyOf(a)) + '</div>';
        Array.prototype.forEach.call(side.querySelectorAll('[data-nt-i]'), function (n) {
            n.onclick = function () { active = Number(n.dataset.ntI) || 0; renderList(); };
        });
    }
    function openList() {
        if (!listBox) return;
        renderList();
        listBox.hidden = false;
        if (win.leleleTrack) win.leleleTrack('notice_open');
    }

    /* ---------- 主页入口按钮 ---------- */
    function buildButton() {
        if (!isHome || btn) return;
        var actions = doc.querySelector('.right-actions');
        if (!actions) return;
        btn = make('button', 'nt-btn');
        btn.id = 'ntBtn';
        btn.type = 'button';
        btn.onclick = openList;
        actions.insertBefore(btn, doc.getElementById('authSlot') || null);
        renderButton();
    }
    function renderButton() {
        if (!btn) return;
        btn.innerHTML = '<span class="zh-inline">📢 查看公告</span><span class="en-inline">📢 Announcements</span>' +
            '<span class="nt-dot"></span>';
        btn.title = t('查看全部公告', 'View all announcements');
        btn.setAttribute('aria-label', btn.title);
    }

    /* ---------- 数据 ---------- */
    function load() {
        var url = base + 'announcements.json';
        var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 5000);
        fetch(url, { signal: ctrl ? ctrl.signal : undefined })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (data) {
                clearTimeout(timer);
                list = (Array.isArray(data) ? data : []).filter(valid)
                    .sort(function (a, b) { return String(b.publishDate || '').localeCompare(String(a.publishDate || '')); });
                if (!list.length) { if (btn) btn.hidden = true; return; }
                renderDaily(); renderList(); renderButton();
                showDaily();
            })
            .catch(function () { clearTimeout(timer); if (btn) btn.hidden = true; });
    }
    function init() {
        if (!doc.body) { doc.addEventListener('DOMContentLoaded', init); return; }
        buildDaily(); buildList(); buildButton();
        win.addEventListener('langChanged', function () { renderDaily(); renderList(); renderButton(); });
        doc.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            closeDaily(); if (listBox) listBox.hidden = true;
        });
        if (UI) UI.registerCommand({
            id: 'notice-open', zh: '查看全部公告', en: 'View all announcements', icon: '📢',
            section: t('公告', 'Announcements'), keywords: 'notice announcement 公告', run: openList
        });
        load();
    }
    win.LeleleNotice = { open: openList, refresh: load };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
})();
