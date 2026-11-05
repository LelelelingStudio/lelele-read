/* ============================================================
   winter.js — 冬季限定特效控制器
   由 common-ui.js 全站动态加载；失败静默，不阻塞首屏。
   ============================================================ */
(function () {
    'use strict';
    var doc = document, win = window;
    var L = win.Lelele;
    var Store = L && L.Store, Bus = L && L.Bus, UI = L && L.UI;
    var KEY = 'winter_enabled';
    var base = /\/data\/community\//.test(location.pathname) ? '../../' : '';
    var isHome = /(^|\/)index\.html?$/.test(location.pathname) || location.pathname === '/';

    function t(zh, en) { return L ? L.t(zh, en) : zh; }
    function esc(s) { return L ? L.esc(s == null ? '' : s) : String(s == null ? '' : s); }
    function get(k, fb) { return Store ? Store.get(k, fb) : fb; }
    function set(k, v) { if (Store) Store.set(k, v); }
    function enabled() { return get(KEY, true) !== false; }
    function make(tag, cls, html) {
        var n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (html != null) n.innerHTML = html;
        return n;
    }
    function rand(a, b) { return a + Math.random() * (b - a); }

    function clear() {
        ['llWinterLayer', 'llWinterBg', 'llWinterCornerLeft', 'llWinterCornerRight', 'llWinterToggle']
            .forEach(function (id) { var n = doc.getElementById(id); if (n) n.remove(); });
    }
    function build() {
        clear();
        doc.documentElement.setAttribute('data-winter', enabled() ? 'on' : 'off');
        var btn = make('button', 'll-winter-toggle');
        btn.id = 'llWinterToggle';
        btn.type = 'button';
        btn.textContent = '❄️';
        btn.title = enabled() ? t('关闭冬季特效', 'Turn off winter effects') : t('开启冬季特效', 'Turn on winter effects');
        btn.setAttribute('aria-label', btn.title);
        btn.onclick = toggle;
        doc.body.appendChild(btn);
        if (!enabled()) return;

        var reduced = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var layer = make('div', 'll-winter-layer');
        layer.id = 'llWinterLayer';
        if (!reduced) {
            var glyphs = ['❄', '❅', '❆', '•'];
            var count = win.innerWidth < 768 ? 18 : 34;
            var frag = doc.createDocumentFragment();
            for (var i = 0; i < count; i++) {
                var f = make('span', 'll-snowflake', glyphs[i % glyphs.length]);
                f.style.left = rand(0, 100).toFixed(2) + '%';
                f.style.fontSize = rand(9, 22).toFixed(1) + 'px';
                f.style.animationDuration = rand(9, 20).toFixed(1) + 's';
                f.style.animationDelay = (-rand(0, 20)).toFixed(1) + 's';
                f.style.setProperty('--drift', rand(-90, 90).toFixed(0) + 'px');
                f.style.opacity = rand(.35, .9).toFixed(2);
                frag.appendChild(f);
            }
            layer.appendChild(frag);
        }
        doc.body.appendChild(layer);

        if (isHome) {
            var bg = make('div', 'll-winter-bg');
            bg.id = 'llWinterBg';
            doc.body.insertBefore(bg, doc.body.firstChild);
            var l = make('div', 'll-winter-corner left'); l.id = 'llWinterCornerLeft';
            var r = make('div', 'll-winter-corner right'); r.id = 'llWinterCornerRight';
            doc.body.appendChild(l); doc.body.appendChild(r);
        }
    }
    function toggle() {
        set(KEY, !enabled());
        build();
        if (UI) UI.toast(enabled() ? t('冬季特效已开启', 'Winter effects on') : t('冬季特效已关闭', 'Winter effects off'));
    }
    function refresh() { build(); }

    function init() {
        if (!doc.body) { doc.addEventListener('DOMContentLoaded', init); return; }
        build();
        if (Bus) Bus.on('storage:' + KEY, function (p) { if (!p.self) refresh(); });
        if (UI) UI.registerCommand({
            id: 'winter-toggle', zh: '切换冬季飘雪特效', en: 'Toggle winter snow', icon: '❄️',
            section: t('外观', 'Appearance'), keywords: 'snow winter 下雪 冬季', run: toggle
        });
        var tid = null;
        win.addEventListener('resize', function () {
            clearTimeout(tid); tid = setTimeout(function () { if (enabled()) build(); }, 400);
        });
    }
    win.LeleleWinter = { toggle: toggle, refresh: refresh, enabled: enabled };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
})();
