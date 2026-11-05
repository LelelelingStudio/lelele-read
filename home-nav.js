/* ============================================================
   home-nav.js — 首页精简排版：排行榜置顶，其余模块收进顶栏目录
   切换分类后书库网格立即可见；移动端目录为底部抽屉。
   ============================================================ */
(function () {
    'use strict';
    var doc = document, win = window;
    var L = win.Lelele, Store = L && L.Store, UI = L && L.UI;
    function t(zh, en) { return L ? L.t(zh, en) : zh; }
    function es(s) { return L ? L.esc(s == null ? '' : s) : String(s == null ? '' : s); }
    function el(id) { return doc.getElementById(id); }
    function make(tag, cls, html) {
        var n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (html != null) n.innerHTML = html;
        return n;
    }

    var SECTIONS = [
        { id: 'rankShowcase', ico: '🏆', zh: '阅读热度榜', en: 'Leaderboard', keep: true },
        { id: 'bookGrid',     ico: '📚', zh: '书库',       en: 'Library',     keep: true },
        { id: 'readerHub',    ico: '📖', zh: '继续阅读',   en: 'Continue reading' },
        { id: 'spStats',      ico: '📊', zh: '我的阅读',   en: 'My reading' },
        { id: 'spRecommend',  ico: '✨', zh: '猜你喜欢',   en: 'Recommended' }
    ];
    var HIDDEN = ['spGreet'];
    var btn = null, panel = null;

    function applyCompact() {
        HIDDEN.concat(['readerHub', 'spStats', 'spRecommend']).forEach(function (id) {
            var n = el(id);
            if (!n) return;
            n.classList.add('hn-section');
            n.hidden = true;
        });
    }
    function renderPanel() {
        if (!panel) return;
        panel.innerHTML = '<div class="hn-title">' + es(t('页面目录', 'SECTIONS')) + '</div>' +
            SECTIONS.map(function (s) {
                var n = el(s.id);
                var opened = n && !n.hidden && !s.keep;
                return '<button type="button" class="hn-item' + (opened ? ' active' : '') + '" data-hn="' + s.id + '">' +
                    '<span class="hn-ico">' + s.ico + '</span>' +
                    '<span>' + es(t(s.zh, s.en)) + '</span>' +
                    (opened ? '<span class="hn-sub">' + es(t('已展开', 'open')) + '</span>' : '') + '</button>';
            }).join('') +
            '<button type="button" class="hn-reset" id="hnReset">' + es(t('收起其它 · 只看排行榜', 'Compact view')) + '</button>';
        Array.prototype.forEach.call(panel.querySelectorAll('[data-hn]'), function (b) {
            b.onclick = function () { go(b.dataset.hn); };
        });
        var reset = el('hnReset');
        if (reset) reset.onclick = function () { applyCompact(); close(); scrollTo('rankShowcase'); };
    }
    function scrollTo(id) {
        var n = el(id);
        if (!n) return;
        try { n.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { n.scrollIntoView(); }
        n.classList.remove('hn-flash');
        void n.offsetWidth;
        n.classList.add('hn-flash');
    }
    function go(id) {
        var n = el(id);
        if (!n) return;
        var s = SECTIONS.filter(function (x) { return x.id === id; })[0];
        if (s && !s.keep) n.hidden = false;
        close();
        setTimeout(function () { scrollTo(id); renderPanel(); }, 30);
    }
    function open() { if (!panel) return; renderPanel(); panel.hidden = false; if (btn) btn.classList.add('active'); }
    function close() { if (panel) panel.hidden = true; if (btn) btn.classList.remove('active'); }
    function toggle() { if (!panel) return; panel.hidden ? open() : close(); }

    function build() {
        var actions = doc.querySelector('.right-actions');
        var main = doc.querySelector('.main-content');
        if (!actions || !main || el('hnBtn')) return;
        btn = make('button', 'hn-btn');
        btn.id = 'hnBtn'; btn.type = 'button';
        btn.onclick = toggle;
        actions.insertBefore(btn, el('authSlot') || null);
        panel = make('div', 'hn-panel');
        panel.id = 'hnPanel'; panel.hidden = true;
        doc.body.appendChild(panel);
        renderButton();
        applyCompact();
        doc.addEventListener('click', function (e) {
            if (panel.hidden || !btn) return;
            if (panel.contains(e.target) || btn.contains(e.target)) return;
            close();
        });
        doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
        win.addEventListener('langChanged', function () { renderButton(); renderPanel(); });
        if (UI) UI.registerCommand({
            id: 'home-sections', zh: '打开首页目录', en: 'Open homepage sections', icon: '☰',
            section: t('导航', 'Navigation'), keywords: 'menu sections 目录', run: open
        });
    }
    function renderButton() {
        if (!btn) return;
        btn.innerHTML = '☰ <span class="zh-inline">目录</span><span class="en-inline">Sections</span>';
        btn.title = t('页面目录', 'Sections');
        btn.setAttribute('aria-label', btn.title);
        btn.setAttribute('aria-expanded', 'false');
    }
    function init() {
        if (!doc.body) { doc.addEventListener('DOMContentLoaded', init); return; }
        build();
        /* shelf-plus / rank-plus 在语言切换时会重绘内容，容器仍在；确保隐藏态不被冲掉 */
        win.addEventListener('langChanged', function () { setTimeout(applyCompact, 0); });
    }
    win.LeleleHomeNav = { open: open, close: close, compact: applyCompact };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
})();
