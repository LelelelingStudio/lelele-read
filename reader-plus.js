/* ============================================================
   reader-plus.js — 阅读器增强模块
   依赖：common.js → common-ui.js → reader.js（Reader 内核）
   对外：window.ReaderPlus，供 reader.js 的段落按钮回调 pickHighlight
   ============================================================ */
(function () {
    'use strict';
    if (!window.Lelele || !window.Reader) return;

    var L = window.Lelele, Store = L.Store, Bus = L.Bus, UI = L.UI;
    var t = L.t, esc = L.esc, dayKey = UI.dayKey;
    var Reader = window.Reader;
    var doc = document, root = doc.documentElement, body = doc.body;

    /* ---------------- 偏好 ---------------- */
    var DEFAULTS = {
        fontWeight: 400, lineHeight: 1.9, paraGap: 1.0, contentWidth: 'medium',
        align: 'left', indent: false, elder: false, typewriter: false,
        pageMode: 'scroll', pageAnim: 'fade', ruler: false, wakeLock: false,
        eyeReminder: true, dailyGoal: 30, translate: false, eyeTheme: '',
        speechRate: 1, speechVoice: '', speechTimer: 0, autoScroll: false
    };
    var prefs = (function () {
        var p = Store.get('reader_prefs', {});
        if (!p || typeof p !== 'object' || Array.isArray(p)) p = {};
        Object.keys(DEFAULTS).forEach(function (k) { if (p[k] === undefined) p[k] = DEFAULTS[k]; });
        return p;
    })();
    function P(k) { return prefs[k]; }
    function setP(k, v) { prefs[k] = v; Store.set('reader_prefs', prefs); }

    var WIDTHS = { narrow: '560px', medium: '720px', wide: '940px', full: '100%' };
    function el(id) { return doc.getElementById(id); }
    function node(tag, cls, html) {
        var n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (html !== undefined) n.innerHTML = html;
        return n;
    }
    function state() { try { return Reader.getState(); } catch (e) { return null; } }
    function scroller() { var n = doc.querySelector('.reader-main'); return n && n.scrollTop !== undefined ? n : null; }
    function toast(msg) { L.UI.toast(msg); }
    function warn(mod, e) { console.warn('[ReaderPlus:' + mod + ']', (e && e.message) || e); }

    /* ---------------- 排版 ---------------- */
    function applyTypography() {
        var s = root.style;
        s.setProperty('--reader-font-weight', P('fontWeight'));
        s.setProperty('--reader-line-height', P('lineHeight'));
        s.setProperty('--reader-para-gap', P('paraGap') + 'em');
        s.setProperty('--reader-content-width', WIDTHS[P('contentWidth')] || WIDTHS.medium);
        s.setProperty('--reader-text-align', P('align'));
        s.setProperty('--reader-indent', P('indent') ? '2em' : '0');
        root.classList.toggle('rp-elder', !!P('elder'));
        root.classList.toggle('rp-typewriter', !!P('typewriter'));
        root.classList.toggle('rp-page-mode', P('pageMode') === 'page');
        root.classList.toggle('rp-ruler-on', !!P('ruler'));
        root.dataset.pageAnim = P('pageAnim');
        if (P('eyeTheme')) root.setAttribute('data-eye-theme', P('eyeTheme'));
        else root.removeAttribute('data-eye-theme');
    }

    /* ---------------- 通用抽屉 ---------------- */
    var drawer = null;
    function ensureDrawer() {
        if (drawer) return drawer;
        drawer = node('div', 'rp-drawer'); drawer.id = 'rpDrawer';
        drawer.innerHTML = '<div class="rp-drawer-head"><b id="rpDrawerTitle"></b><button type="button" class="ll-x" id="rpDrawerClose">×</button></div><div class="rp-drawer-body" id="rpDrawerBody"></div>';
        body.appendChild(drawer);
        el('rpDrawerClose').onclick = function () { drawer.classList.remove('open'); };
        return drawer;
    }
    function openDrawer(title, html, after) {
        ensureDrawer();
        el('rpDrawerTitle').textContent = title;
        el('rpDrawerBody').innerHTML = html;
        drawer.classList.add('open');
        if (after) after(el('rpDrawerBody'));
    }

    /* ---------------- 1 / 66 进度与剩余时间 ---------------- */
    var progressInfo = null;
    function ensureProgressInfo() {
        if (progressInfo) return progressInfo;
        var line = doc.querySelector('.reader-progress-line');
        if (!line) return null;
        progressInfo = node('div', 'rp-progress-info'); progressInfo.id = 'rpProgressInfo';
        line.appendChild(progressInfo);
        return progressInfo;
    }
    function wordCount(text) {
        text = String(text || '');
        var cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        var en = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z']+/g) || []).length;
        return cn + en;
    }
    function updateProgress() {
        var st = state(); if (!st || !st.bookData) return;
        var total = st.chapters || 1, chap = st.chapter + 1;
        var pct = Math.round(chap / total * 100);
        var fill = el('readerProgressFill'); if (fill) fill.style.width = pct + '%';
        var info = ensureProgressInfo(); if (!info) return;
        var ch = st.bookData.chapters[st.chapter] || {};
        var words = (ch.content || []).reduce(function (n, p) { return n + wordCount(p); }, 0);
        var restWords = 0;
        for (var i = st.chapter + 1; i < st.bookData.chapters.length; i++) {
            restWords += (st.bookData.chapters[i].content || []).reduce(function (n, p) { return n + wordCount(p); }, 0);
        }
        var mins = Math.max(1, Math.round(words / 300));
        var restMins = Math.round(restWords / 300);
        var restText = restMins >= 60 ? (restMins / 60).toFixed(1) + ' h' : restMins + ' min';
        info.textContent = t('第 ', 'Ch. ') + chap + ' / ' + total + ' · ' + pct + '% · ' +
            t('本章约 ', '~') + mins + ' min · ' + t('全书剩余 ', 'left ') + (restWords ? restText : '—');
    }

    /* ---------------- 2 书内全文搜索 ---------------- */
    var searchLayer = null, searchIndex = null, searchTimer = null;
    function ensureSearch() {
        if (searchLayer) return searchLayer;
        searchLayer = node('div', 'rp-search'); searchLayer.id = 'rpSearch';
        searchLayer.innerHTML = '<div class="rp-search-box"><input type="text" id="rpSearchInput" autocomplete="off"><button type="button" class="ll-x" id="rpSearchClose">×</button></div><div class="rp-search-results" id="rpSearchResults"></div>';
        body.appendChild(searchLayer);
        el('rpSearchInput').addEventListener('input', function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(runSearch, 220);
        });
        el('rpSearchInput').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { var f = searchLayer.querySelector('.rp-hit'); if (f) f.click(); }
            if (e.key === 'Escape') closeSearch();
        });
        el('rpSearchClose').onclick = closeSearch;
        return searchLayer;
    }
    function openSearch(kw) {
        ensureSearch();
        searchLayer.classList.add('open');
        var inp = el('rpSearchInput');
        inp.value = kw || '';
        inp.placeholder = t('搜索全书内容…', 'Search the whole book…');
        inp.focus();
        runSearch();
    }
    function closeSearch() { if (searchLayer) searchLayer.classList.remove('open'); }
    async function buildIndex() {
        if (searchIndex) return searchIndex;
        var st = state(); if (!st || !st.bookData) return [];
        el('rpSearchResults').innerHTML = '<div class="ll-empty">' + esc(t('正在准备全文索引…', 'Building full-text index…')) + '</div>';
        try { await Reader.ensureAll(); } catch (e) { warn('ensureAll', e); }
        var idx = [];
        st.bookData.chapters.forEach(function (ch, ci) {
            (ch.content || []).forEach(function (text, pi) { idx.push({ chap: ci, para: pi, text: String(text) }); });
        });
        searchIndex = idx;
        return idx;
    }
    async function runSearch() {
        var box = el('rpSearchResults'); if (!box) return;
        var q = (el('rpSearchInput').value || '').trim().toLowerCase();
        if (!q) { box.innerHTML = '<div class="ll-empty">' + esc(t('输入关键词开始搜索', 'Type to search')) + '</div>'; return; }
        var idx = await buildIndex();
        var hits = idx.filter(function (r) { return r.text.toLowerCase().indexOf(q) >= 0; }).slice(0, 60);
        if (!hits.length) { box.innerHTML = '<div class="ll-empty">' + esc(t('没有找到', 'No matches')) + '</div>'; return; }
        var st = state();
        box.innerHTML = hits.map(function (r, i) {
            var pos = r.text.toLowerCase().indexOf(q);
            var from = Math.max(0, pos - 28), snippet = r.text.slice(from, from + 110);
            var highlighted = esc(snippet).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), function (m) { return '<span class="ll-mark">' + m + '</span>'; });
            var chTitle = st && st.bookData.chapters[r.chap] ? (st.bookData.chapters[r.chap].title || ('# ' + (r.chap + 1))) : ('# ' + (r.chap + 1));
            return '<button type="button" class="rp-hit" data-chap="' + r.chap + '" data-para="' + r.para + '">' +
                '<span class="rp-hit-where">' + esc(chTitle) + ' · ' + (r.para + 1) + '</span>' +
                '<span class="rp-hit-text">' + highlighted + '…</span></button>';
        }).join('') + (hits.length >= 60 ? '<div class="ll-empty">' + esc(t('仅显示前 60 条', 'Showing first 60')) + '</div>' : '');
        Array.prototype.forEach.call(box.querySelectorAll('.rp-hit'), function (b) {
            b.onclick = function () {
                var c = parseInt(b.dataset.chap, 10), p = parseInt(b.dataset.para, 10);
                closeSearch();
                Reader.setChapter(c).then(function () {
                    setTimeout(function () {
                        var n = el('para-' + p);
                        if (n) n.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 140);
                });
            };
        });
    }

    /* ---------------- 3 / 67 打字机与阅读尺 ---------------- */
    var rafPending = false;
    function updateCurrentPara() {
        rafPending = false;
        if (!P('typewriter') && !P('ruler')) return;
        var container = el('readerContent'); if (!container) return;
        var target = (window.innerHeight || 800) * 0.42;
        var best = null, bestDist = Infinity;
        Array.prototype.forEach.call(container.querySelectorAll('.reader-para'), function (n) {
            var r = n.getBoundingClientRect();
            var d = Math.abs((r.top + r.bottom) / 2 - target);
            if (d < bestDist) { bestDist = d; best = n; }
            n.classList.remove('rp-current');
        });
        if (best) best.classList.add('rp-current');
    }
    function onScroll() {
        if (!rafPending) { rafPending = true; requestAnimationFrame(updateCurrentPara); }
        saveScrollPos();
    }

    /* ---------------- 14 滚动位置记忆到段落 ---------------- */
    var scrollTimer = null;
    function scrollKey() { var st = state(); return st ? 'lelele_read_scrollpos_' + st.bookId : null; }
    function saveScrollPos() {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(function () {
            var s = scroller(), k = scrollKey(), st = state();
            if (!s || !k || !st) return;
            var best = 0, bestDist = Infinity;
            Array.prototype.forEach.call(doc.querySelectorAll('.reader-para'), function (n) {
                var d = Math.abs(n.getBoundingClientRect().top - 120);
                if (d < bestDist) { bestDist = d; best = parseInt((n.id || '').replace('para-', ''), 10) || 0; }
            });
            try { localStorage.setItem(k, JSON.stringify({ chap: st.chapter, para: best, top: s.scrollTop })); } catch (e) { }
        }, 400);
    }
    function restoreScrollPos() {
        var k = scrollKey(); if (!k) return;
        try {
            var d = JSON.parse(localStorage.getItem(k) || 'null');
            if (!d) return;
            var st = state(); if (!st || d.chap !== st.chapter) return;
            var n = el('para-' + d.para); if (!n) return;
            setTimeout(function () { n.scrollIntoView({ block: 'start' }); }, 180);
        } catch (e) { }
    }

    /* ---------------- 4 / 68 翻页模式 ---------------- */
    function scrollPage(dir) {
        var s = scroller(); if (!s) return;
        var h = Math.max(200, s.clientHeight * 0.88);
        s.scrollBy({ top: dir * h, behavior: root.classList.contains('ll-reduced-motion') ? 'auto' : 'smooth' });
    }
    function flashPageAnim() {
        var c = el('readerContent'); if (!c) return;
        var name = 'rp-anim-' + P('pageAnim');
        c.classList.remove('rp-anim-fade', 'rp-anim-slide', 'rp-anim-simulation');
        if (P('pageAnim') !== 'none') { void c.offsetWidth; c.classList.add(name); }
    }

    /* ---------------- 5 / 6 / 74 护眼提醒、每日目标、周榜 ---------------- */
    var goalShownKey = 'lelele_read_goal_done_';
    function weekStats() {
        var d = Store.daily(), now = new Date();
        var thisWeek = 0, lastWeek = 0, series = [];
        for (var i = 6; i >= 0; i--) {
            var dt = new Date(now); dt.setDate(dt.getDate() - i);
            var k = dayKey(dt), sec = (d[k] && d[k].seconds) || 0;
            series.push({ label: (dt.getMonth() + 1) + '/' + dt.getDate(), min: Math.round(sec / 60) });
            thisWeek += sec;
            var prev = new Date(dt); prev.setDate(prev.getDate() - 7);
            lastWeek += (d[dayKey(prev)] && d[dayKey(prev)].seconds) || 0;
        }
        return { series: series, thisWeek: Math.round(thisWeek / 60), lastWeek: Math.round(lastWeek / 60) };
    }
    function streakDays() {
        var d = Store.daily(), n = 0, dt = new Date();
        for (var i = 0; i < 400; i++) {
            var k = dayKey(dt);
            if (d[k] && (d[k].seconds || 0) > 0) n++;
            else if (i > 0) break;
            dt.setDate(dt.getDate() - 1);
        }
        return n;
    }
    function checkGoal() {
        if (!P('dailyGoal')) return;
        var d = Store.daily()[dayKey()] || {}, sec = d.seconds || 0;
        var key = goalShownKey + dayKey();
        if (sec >= P('dailyGoal') * 60 && !localStorage.getItem(key)) {
            try { localStorage.setItem(key, '1'); } catch (e) { }
            toast(t('今日阅读目标达成，真棒！', "Today's reading goal reached. Well done!"));
        }
    }
    function initReminders() {
        setInterval(function () {
            if (!P('eyeReminder') || doc.hidden) return;
            toast(t('已连续阅读 20 分钟，抬头看看远处吧', 'You have been reading for 20 minutes. Rest your eyes.'));
        }, 20 * 60 * 1000);
        Bus.on('daily', function () { checkGoal(); });
    }

    /* ---------------- 13 / 72 朗读与听书 ---------------- */
    var speech = { queue: [], i: 0, rate: 1, timer: null, active: false };
    var speechBar = null;
    function voices() {
        try { return window.speechSynthesis ? window.speechSynthesis.getVoices() : []; } catch (e) { return []; }
    }
    function ensureSpeechBar() {
        if (speechBar) return speechBar;
        speechBar = node('div', 'rp-speech'); speechBar.id = 'rpSpeech';
        body.appendChild(speechBar);
        return speechBar;
    }
    function renderSpeechBar() {
        ensureSpeechBar();
        var vs = voices().map(function (v, i) {
            return '<option value="' + i + '"' + (String(P('speechVoice')) === String(i) ? ' selected' : '') + '>' + esc(v.name) + '</option>';
        }).join('');
        speechBar.innerHTML =
            '<button type="button" class="rd-btn" id="rpSpeakToggle">' + esc(t('▶ 朗读', '▶ Read aloud')) + '</button>' +
            '<button type="button" class="rd-btn" id="rpSpeakStop">' + esc(t('■ 停止', '■ Stop')) + '</button>' +
            '<label class="ll-switch">' + esc(t('语速', 'Rate')) + ' <input type="range" id="rpRate" min="0.5" max="2" step="0.1" value="' + P('speechRate') + '"></label>' +
            '<label class="ll-switch">' + esc(t('音色', 'Voice')) + ' <select id="rpVoice">' + vs + '</select></label>' +
            '<label class="ll-switch">' + esc(t('定时', 'Timer')) + ' <select id="rpTimer"><option value="0">' + esc(t('不限', 'Off')) + '</option><option value="30">30 min</option><option value="60">60 min</option></select></label>' +
            '<button type="button" class="rd-btn" id="rpSpeakHere">' + esc(t('↩ 回到原文', '↩ Back to text')) + '</button>' +
            '<span class="rp-speaking-now" id="rpSpeakingNow"></span>';
        el('rpSpeakToggle').onclick = function () {
            if (!speech.active) return startSpeech();
            try {
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                else window.speechSynthesis.pause();
                renderSpeechBar();
            } catch (e) { warn('speechToggle', e); }
        };
        el('rpSpeakStop').onclick = stopSpeech;
        el('rpSpeakHere').onclick = function () {
            var n = doc.querySelector('.rp-speaking');
            if (n) n.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        el('rpRate').oninput = function () { setP('speechRate', parseFloat(this.value)); if (speech.active) { stopSpeech(); startSpeech(); } };
        el('rpVoice').onchange = function () { setP('speechVoice', this.value); if (speech.active) { stopSpeech(); startSpeech(); } };
        el('rpTimer').onchange = function () {
            clearTimeout(speech.timer);
            var m = parseInt(this.value, 10);
            if (m) speech.timer = setTimeout(stopSpeech, m * 60000);
        };
        speechBar.classList.toggle('open', speech.active);
    }
    function startSpeech() {
        if (!('speechSynthesis' in window)) { toast(t('当前浏览器不支持语音朗读', 'Speech synthesis is not supported in this browser')); return; }
        var st = state(); if (!st || !st.bookData) return;
        var ch = st.bookData.chapters[st.chapter] || {};
        speech.queue = (ch.content || []).map(String).filter(function (x) { return x.trim(); });
        if (!speech.queue.length) return;
        speech.i = 0; speech.active = true;
        renderSpeechBar();
        speakNext();
    }
    function speakNext() {
        if (!speech.active || speech.i >= speech.queue.length) {
            var st = state();
            if (speech.active && st && st.chapter + 1 < st.chapters) {
                Reader.setChapter(st.chapter + 1).then(function () { setTimeout(startSpeech, 300); });
                return;
            }
            stopSpeech(); return;
        }
        try {
            var u = new SpeechSynthesisUtterance(speech.queue[speech.i]);
            u.rate = P('speechRate') || 1;
            var v = voices()[parseInt(P('speechVoice'), 10)];
            if (v) u.voice = v;
            u.lang = /[\u4e00-\u9fa5]/.test(speech.queue[speech.i]) ? 'zh-CN' : 'en-US';
            u.onend = function () { speech.i++; setTimeout(speakNext, 120); };
            u.onerror = function () { stopSpeech(); };
            window.speechSynthesis.speak(u);
            Array.prototype.forEach.call(doc.querySelectorAll('.rp-speaking'), function (n) { n.classList.remove('rp-speaking'); });
            var para = doc.querySelector('.reader-para[data-para="' + speech.i + '"]') || doc.querySelectorAll('.reader-para')[speech.i];
            if (para) para.classList.add('rp-speaking');
            var now = el('rpSpeakingNow');
            if (now) now.textContent = (speech.i + 1) + ' / ' + speech.queue.length;
        } catch (e) { warn('speech', e); stopSpeech(); }
    }
    function pauseSpeech() {
        try { window.speechSynthesis.pause(); speech.active = false; } catch (e) { }
        renderSpeechBar();
        if (el('rpSpeakToggle')) el('rpSpeakToggle').textContent = t('▶ 继续', '▶ Resume');
    }
    function stopSpeech() {
        speech.active = false; clearTimeout(speech.timer);
        try { window.speechSynthesis.cancel(); } catch (e) { }
        Array.prototype.forEach.call(doc.querySelectorAll('.rp-speaking'), function (n) { n.classList.remove('rp-speaking'); });
        renderSpeechBar();
    }

    /* ---------------- 16 划词翻译（免密钥公开端点，默认关闭） ---------------- */
    var translateBox = null, translateSeq = 0;
    function showTranslate(text, x, y) {
        if (!translateBox) {
            translateBox = node('div', 'rp-translate'); translateBox.id = 'rpTranslate';
            body.appendChild(translateBox);
            translateBox.onclick = function () { translateBox.hidden = true; };
        }
        var seq = ++translateSeq;
        translateBox.hidden = false;
        translateBox.style.left = Math.min(x, window.innerWidth - 260) + 'px';
        translateBox.style.top = Math.min(y + 16, window.innerHeight - 120) + 'px';
        translateBox.textContent = t('翻译中…', 'Translating…');
        var isZh = /[\u4e00-\u9fa5]/.test(text);
        var pair = isZh ? 'zh-CN|en' : 'en|zh-CN';
        var url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text.slice(0, 200)) + '&langpair=' + encodeURIComponent(pair);
        var ctrl = new AbortController(); var timer = setTimeout(function () { ctrl.abort(); }, 6000);
        fetch(url, { signal: ctrl.signal }).then(function (r) { return r.json(); }).then(function (d) {
            clearTimeout(timer); if (seq !== translateSeq) return;
            var out = d && d.responseData && d.responseData.translatedText;
            translateBox.textContent = out ? esc(String(out)) : t('暂时无法翻译', 'Translation unavailable');
            if (out) translateBox.innerHTML = esc(String(out));
        }).catch(function () {
            clearTimeout(timer); if (seq !== translateSeq) return;
            translateBox.hidden = true;   // 失败静默降级，不打扰阅读
        });
    }
    function initTranslate() {
        doc.addEventListener('mouseup', function (e) {
            if (!P('translate') || !state() || !state().bookData) return;
            var sel = window.getSelection();
            var text = sel ? String(sel).trim() : '';
            if (!text || text.length < 2 || text.length > 200) return;
            showTranslate(text, e.clientX, e.clientY);
        });
    }

    /* ---------------- 18 引用卡片 ---------------- */
    function wrapText(ctx, text, maxWidth) {
        var lines = [], line = '';
        for (var i = 0; i < text.length; i++) {
            var test = line + text[i];
            if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = text[i]; }
            else line = test;
        }
        if (line) lines.push(line);
        return lines;
    }
    function makeQuoteCard(text) {
        var st = state() || {};
        var c = doc.createElement('canvas'); c.width = 1200; c.height = 630;
        var g = c.getContext('2d');
        var grad = g.createLinearGradient(0, 0, 1200, 630);
        grad.addColorStop(0, '#f7f2e7'); grad.addColorStop(1, '#e6efe9');
        g.fillStyle = grad; g.fillRect(0, 0, 1200, 630);
        g.fillStyle = 'rgba(60,110,113,.10)';
        g.beginPath(); g.arc(1080, 90, 150, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#3C6E71'; g.font = 'bold 34px serif';
        g.fillText('了了了读 · lelele Read', 80, 92);
        g.fillStyle = '#2f3a38'; g.font = '30px "Songti SC", "Noto Serif SC", serif';
        var lines = wrapText(g, String(text || '').trim(), 1040).slice(0, 9);
        lines.forEach(function (ln, i) { g.fillText(ln, 80, 210 + i * 52); });
        g.fillStyle = '#7a8a86'; g.font = '22px sans-serif';
        g.fillText('— ' + String(st.title || ''), 80, 570);
        g.fillStyle = '#3C6E71'; g.fillRect(80, 160, 76, 4);
        return c.toDataURL('image/png');
    }
    function showQuote(text) {
        var data = '';
        try { data = makeQuoteCard(text); } catch (e) { warn('quote', e); toast(t('引用卡片生成失败', 'Could not create quote card')); return; }
        openDrawer(t('引用卡片', 'Quote card'),
            '<img class="rp-quote-img" alt="quote" src="' + data + '">' +
            '<div class="ll-row"><button type="button" class="rd-btn primary" id="rpQuoteDownload">' + esc(t('下载图片', 'Download image')) + '</button></div>',
            function (box) {
                box.querySelector('#rpQuoteDownload').onclick = function () {
                    var a = doc.createElement('a'); a.href = data; a.download = 'lelele-quote.png'; a.click();
                };
            });
    }

    /* ---------------- 65 屏幕常亮 ---------------- */
    var wakeLock = null;
    async function applyWakeLock() {
        if (!P('wakeLock') || !('wakeLock' in navigator)) { releaseWake(); return; }
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { warn('wakeLock', e); }
    }
    function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) { } wakeLock = null; }

    /* ---------------- 69 X-Ray 词频索引 ---------------- */
    var STOP = ('的了在是和与之及也不我你他她它们这那有为以而于其中上下来到说就都还很对被把从或但如所其者此然后一个我们你们他们没有可以因为所以如果虽然即使不过而且以及什么怎么这样那样一些一种时候地方已经自己不过').split('');
    function xrayTop(n) {
        var st = state(); if (!st || !st.bookData) return [];
        var freq = Object.create(null);
        st.bookData.chapters.forEach(function (ch) {
            (ch.content || []).forEach(function (p) {
                var segs = String(p).match(/[\u4e00-\u9fa5]{2,}/g) || [];
                segs.forEach(function (seg) {
                    for (var i = 0; i < seg.length - 1; i++) {
                        var w = seg.substr(i, 2);
                        if (STOP.indexOf(w[0]) < 0 && STOP.indexOf(w[1]) < 0) freq[w] = (freq[w] || 0) + 1;
                    }
                });
            });
        });
        return Object.keys(freq).map(function (w) { return { word: w, count: freq[w] }; })
            .filter(function (x) { return x.count > 1; })
            .sort(function (a, b) { return b.count - a.count; }).slice(0, n || 30);
    }
    function showXray() {
        var list = xrayTop(36);
        var html = '<p class="ll-note">' + esc(t('从已加载的全书内容中提取的高频词，点一个词可在全书中搜索。', 'Frequent terms extracted from loaded chapters. Tap one to search the whole book.')) + '</p>' +
            (list.length ? '<div class="ll-chip-row">' + list.map(function (x) {
                return '<button type="button" class="ll-chip" data-w="' + esc(x.word) + '">' + esc(x.word) + ' <small>' + x.count + '</small></button>';
            }).join('') + '</div>' : '<div class="ll-empty">' + esc(t('暂无足够内容', 'Not enough content yet')) + '</div>');
        openDrawer(t('全书脉络 · X-Ray', 'Book index · X-Ray'), html, function (box) {
            Array.prototype.forEach.call(box.querySelectorAll('[data-w]'), function (b) {
                b.onclick = function () { drawer.classList.remove('open'); openSearch(b.dataset.w); };
            });
        });
    }

    /* ---------------- 70 划线色板 ---------------- */
    var hlPop = null;
    var COLORS = [['yellow', '#ffe066'], ['green', '#a7e8b5'], ['pink', '#ffb3c6'], ['blue', '#a8d5ff']];
    var STYLES = [['marker', t('荧光', 'Marker')], ['underline', t('下划线', 'Underline')], ['wave', t('波浪线', 'Wavy')]];
    function pickHighlight(btn, idx) {
        if (!hlPop) { hlPop = node('div', 'rp-hlpop'); hlPop.id = 'rpHlPop'; body.appendChild(hlPop); }
        var st = state() || {}, notes = st.notes || { highlights: [] };
        var cur = (notes.highlights || []).find(function (h) { return h.chap === st.chapter && h.para === idx; });
        hlPop.innerHTML =
            '<div class="rp-hl-row">' + COLORS.map(function (c) {
                return '<button type="button" class="rp-hl-color" data-color="' + c[0] + '" style="background:' + c[1] + '" title="' + c[0] + '"></button>';
            }).join('') + '</div>' +
            '<div class="rp-hl-row">' + STYLES.map(function (s) {
                return '<button type="button" class="ll-chip" data-style="' + s[0] + '">' + esc(s[1]) + '</button>';
            }).join('') + '</div>' +
            (cur ? '<button type="button" class="ll-chip" data-remove="1">' + esc(t('取消高亮', 'Remove highlight')) + '</button>' : '');
        var r = btn.getBoundingClientRect();
        hlPop.style.left = Math.max(8, Math.min(r.left - 40, window.innerWidth - 230)) + 'px';
        hlPop.style.top = Math.min(r.bottom + 8, window.innerHeight - 130) + 'px';
        hlPop.hidden = false;
        hlPop.onclick = function (e) {
            var b = e.target.closest('button'); if (!b) return;
            hlPop.hidden = true;
            if (b.dataset.remove) return Reader.toggleHighlight(idx);
            Reader.toggleHighlight(idx, { color: b.dataset.color || 'yellow', style: b.dataset.style || 'marker' });
        };
        setTimeout(function () {
            doc.addEventListener('click', function once(e) {
                if (hlPop && !hlPop.contains(e.target)) { hlPop.hidden = true; doc.removeEventListener('click', once); }
            });
        }, 0);
    }

    /* ---------------- 71 移动端手势 ---------------- */
    function initGestures() {
        var sx = 0, sy = 0, st = 0;
        body.addEventListener('touchstart', function (e) {
            var touch = e.touches[0]; sx = touch.clientX; sy = touch.clientY; st = Date.now();
        }, { passive: true });
        body.addEventListener('touchend', function (e) {
            if (Date.now() - st > 700) return;
            var touch = e.changedTouches[0], dx = touch.clientX - sx, dy = touch.clientY - sy;
            if (dy > 90 && sy < 130 && Math.abs(dx) < 60) {
                var s = state(); if (!s || !s.bookData) return;
                Reader.toggleBookmark(0);
                toast(t('已为本章添加书签', 'Bookmark added to this chapter'));
            } else if (dx < -110 && Math.abs(dy) < 70) {
                var sb = doc.querySelector('.reader-sidebar'); if (sb) sb.classList.remove('open');
                var dock = el('rpDock'); if (dock) dock.classList.remove('open');
            }
        }, { passive: true });
    }

    /* ---------------- 设置抽屉 ---------------- */
    function rangeRow(label, key, min, max, step, fmt) {
        return '<div class="rp-field"><label>' + esc(label) + ' <b id="rpv_' + key + '">' + esc(fmt ? fmt(P(key)) : P(key)) + '</b></label>' +
            '<input type="range" data-pref="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + P(key) + '"></div>';
    }
    function toggleRow(label, key) {
        return '<label class="rp-toggle"><input type="checkbox" data-pref="' + key + '"' + (P(key) ? ' checked' : '') + '> ' + esc(label) + '</label>';
    }
    function showSettings() {
        var w = weekStats();
        var bars = w.series.map(function (s) {
            var max = Math.max.apply(null, w.series.map(function (x) { return x.min; }).concat([1]));
            return '<div class="ll-bar-wrap"><div class="ll-bar' + (s.min ? '' : ' dim') + '" style="height:' + Math.max(3, s.min / max * 78) + 'px"></div><span class="ll-bar-label">' + esc(s.label) + '</span></div>';
        }).join('');
        var html =
            '<h4>' + esc(t('排版', 'Typography')) + '</h4>' +
            rangeRow(t('字重', 'Font weight'), 'fontWeight', 300, 800, 100, null) +
            rangeRow(t('行距', 'Line height'), 'lineHeight', 1.4, 2.6, 0.1, null) +
            rangeRow(t('段距', 'Paragraph gap'), 'paraGap', 0.4, 2.2, 0.1, null) +
            '<div class="rp-field"><label>' + esc(t('内容宽度', 'Content width')) + '</label><div class="ll-chip-row">' +
            [['narrow', t('窄', 'Narrow')], ['medium', t('中', 'Medium')], ['wide', t('宽', 'Wide')], ['full', t('铺满', 'Full')]].map(function (x) {
                return '<button type="button" class="ll-chip' + (P('contentWidth') === x[0] ? ' active' : '') + '" data-width="' + x[0] + '">' + esc(x[1]) + '</button>';
            }).join('') + '</div></div>' +
            '<div class="rp-field"><label>' + esc(t('对齐方式', 'Alignment')) + '</label><div class="ll-chip-row">' +
            [['left', t('左对齐', 'Left')], ['justify', t('两端对齐', 'Justify')]].map(function (x) {
                return '<button type="button" class="ll-chip' + (P('align') === x[0] ? ' active' : '') + '" data-align="' + x[0] + '">' + esc(x[1]) + '</button>';
            }).join('') + '</div></div>' +
            toggleRow(t('首行缩进', 'First-line indent'), 'indent') +
            toggleRow(t('长辈模式（大字号高对比）', 'Elder mode (large text)'), 'elder') +

            '<h4>' + esc(t('护眼主题', 'Eye-care themes')) + '</h4><div class="ll-chip-row">' +
            [['', t('默认', 'Default')], ['green', t('护眼绿', 'Green')], ['sepia', t('羊皮纸', 'Sepia')], ['blue', t('静谧蓝', 'Blue')], ['pink', t('浪漫粉', 'Pink')], ['gray', t('薄雾灰', 'Gray')]].map(function (x) {
                return '<button type="button" class="ll-chip' + (P('eyeTheme') === x[0] ? ' active' : '') + '" data-eye="' + x[0] + '">' + esc(x[1]) + '</button>';
            }).join('') + '</div>' +

            '<h4>' + esc(t('阅读方式', 'Reading mode')) + '</h4>' +
            '<div class="rp-field"><div class="ll-chip-row">' +
            [['scroll', t('连续滚动', 'Continuous')], ['page', t('翻页模式', 'Paged')]].map(function (x) {
                return '<button type="button" class="ll-chip' + (P('pageMode') === x[0] ? ' active' : '') + '" data-pagemode="' + x[0] + '">' + esc(x[1]) + '</button>';
            }).join('') + '</div></div>' +
            '<div class="rp-field"><label>' + esc(t('翻页动画', 'Page animation')) + '</label><div class="ll-chip-row">' +
            [['none', t('无', 'None')], ['fade', t('淡入', 'Fade')], ['slide', t('平移', 'Slide')], ['simulation', t('仿真', 'Curl')]].map(function (x) {
                return '<button type="button" class="ll-chip' + (P('pageAnim') === x[0] ? ' active' : '') + '" data-anim="' + x[0] + '">' + esc(x[1]) + '</button>';
            }).join('') + '</div></div>' +
            toggleRow(t('打字机模式', 'Typewriter mode'), 'typewriter') +
            toggleRow(t('阅读尺（高亮当前行）', 'Reading ruler'), 'ruler') +
            toggleRow(t('屏幕常亮', 'Keep screen awake'), 'wakeLock') +
            toggleRow(t('20 分钟护眼提醒', '20-minute eye reminder'), 'eyeReminder') +
            toggleRow(t('划词翻译（测试，需联网）', 'Selection translation (beta, online)'), 'translate') +

            '<h4>' + esc(t('听书', 'Listen')) + '</h4>' +
            '<div class="ll-row"><button type="button" class="rd-btn" id="rpOpenSpeech">' + esc(t('打开朗读控制条', 'Open audio controls')) + '</button></div>' +

            '<h4>' + esc(t('目标与统计', 'Goals & stats')) + '</h4>' +
            rangeRow(t('每日目标（分钟）', 'Daily goal (min)'), 'dailyGoal', 5, 180, 5, null) +
            '<p class="ll-muted">' + esc(t('本周 ', 'This week ')) + w.thisWeek + ' min · ' + esc(t('上周 ', 'Last week ')) + w.lastWeek + ' min · ' + esc(t('连续 ', 'Streak ')) + streakDays() + esc(t(' 天', ' days')) + '</p>' +
            '<div class="ll-bars">' + bars + '</div>' +
            '<div class="ll-row"><button type="button" class="rd-btn" id="rpResetPrefs">' + esc(t('恢复默认排版', 'Reset typography')) + '</button>' +
            '<button type="button" class="rd-btn" id="rpOpenBackup">' + esc(t('数据备份', 'Data backup')) + '</button></div>';

        openDrawer(t('阅读设置', 'Reading settings'), html, function (box) {
            Array.prototype.forEach.call(box.querySelectorAll('[data-pref]'), function (input) {
                input.addEventListener('input', function () {
                    var k = input.dataset.pref;
                    var v = input.type === 'checkbox' ? input.checked : (input.step && input.step.indexOf('.') >= 0 ? parseFloat(input.value) : parseInt(input.value, 10));
                    setP(k, v);
                    var lab = el('rpv_' + k); if (lab) lab.textContent = v;
                    applyTypography();
                    if (k === 'wakeLock') applyWakeLock();
                });
            });
            function chipGroup(attr, key) {
                Array.prototype.forEach.call(box.querySelectorAll('[' + attr + ']'), function (b) {
                    b.onclick = function () {
                        setP(key, b.getAttribute(attr));
                        applyTypography();
                        Array.prototype.forEach.call(box.querySelectorAll('[' + attr + ']'), function (x) { x.classList.remove('active'); });
                        b.classList.add('active');
                    };
                });
            }
            chipGroup('data-width', 'contentWidth');
            chipGroup('data-align', 'align');
            chipGroup('data-eye', 'eyeTheme');
            chipGroup('data-pagemode', 'pageMode');
            chipGroup('data-anim', 'pageAnim');
            el('rpOpenSpeech').onclick = function () { renderSpeechBar(); startSpeech(); };
            el('rpOpenBackup').onclick = function () { UI.openBackup(); };
            el('rpResetPrefs').onclick = function () {
                Object.keys(DEFAULTS).forEach(function (k) { prefs[k] = DEFAULTS[k]; });
                Store.set('reader_prefs', prefs); applyTypography(); showSettings();
                toast(t('已恢复默认排版', 'Typography reset'));
            };
        });
    }

    /* ---------------- 浮动工具坞 ---------------- */
    var dock = null;
    var DOCK_ITEMS = [
        ['search', '🔍', '搜索全书', 'Search book', function () { openSearch(); }],
        ['settings', '⚙️', '阅读设置', 'Settings', function () { showSettings(); }],
        ['speech', '🔊', '听书', 'Listen', function () { renderSpeechBar(); if (!speech.active) startSpeech(); }],
        ['xray', '🧭', '全书脉络', 'Book index', function () { showXray(); }],
        ['palette', '🖍️', '划线颜色', 'Highlight colors', function () {
            toast(t('点任意段落的画笔按钮即可选颜色', 'Tap the brush on any paragraph to pick a color'));
        }],
        ['typewriter', '⌨️', '打字机模式', 'Typewriter', function () { setP('typewriter', !P('typewriter')); applyTypography(); toast(P('typewriter') ? t('打字机模式已开启', 'Typewriter on') : t('打字机模式已关闭', 'Typewriter off')); }],
        ['wake', '☀️', '屏幕常亮', 'Keep awake', function () { setP('wakeLock', !P('wakeLock')); applyWakeLock(); toast(P('wakeLock') ? t('屏幕常亮已开启', 'Screen stays awake') : t('屏幕常亮已关闭', 'Screen sleep restored')); }],
        ['cmd', '⌘', '命令面板', 'Commands', function () { UI.openCommand(); }],
        ['notes', '📝', '我的笔记', 'My notes', function () { var p = el('readerNotesPanel'); if (p) p.classList.toggle('open'); }]
    ];
    function buildDock() {
        dock = node('div', 'rp-dock'); dock.id = 'rpDock';
        dock.innerHTML = '<button type="button" class="rp-dock-toggle" id="rpDockToggle">✦</button><div class="rp-dock-items">' +
            DOCK_ITEMS.map(function (it) {
                return '<button type="button" data-id="' + it[0] + '" title="' + esc(t(it[2], it[3])) + '">' + it[1] + '</button>';
            }).join('') + '</div>';
        body.appendChild(dock);
        el('rpDockToggle').onclick = function () { dock.classList.toggle('open'); };
        Array.prototype.forEach.call(dock.querySelectorAll('[data-id]'), function (b) {
            b.onclick = function () {
                var it = DOCK_ITEMS.filter(function (x) { return x[0] === b.dataset.id; })[0];
                if (it) try { it[4](); } catch (e) { warn('dock:' + it[0], e); }
            };
        });
    }

    /* ---------------- 命令注册 ---------------- */
    function registerCommands() {
        [
            { id: 'rp-search', zh: '搜索全书内容', en: 'Search in book', icon: '🔍', section: 'Reader', run: function () { openSearch(); } },
            { id: 'rp-settings', zh: '阅读设置与排版', en: 'Reading settings', icon: '⚙️', section: 'Reader', run: function () { showSettings(); } },
            { id: 'rp-listen', zh: '开始 / 继续听书', en: 'Start / resume listening', icon: '🔊', section: 'Reader', run: function () { renderSpeechBar(); if (!speech.active) startSpeech(); } },
            { id: 'rp-xray', zh: '全书脉络 X-Ray', en: 'Book index (X-Ray)', icon: '🧭', section: 'Reader', run: function () { showXray(); } },
            { id: 'rp-typewriter', zh: '切换打字机模式', en: 'Toggle typewriter', icon: '⌨️', section: 'Reader', run: function () { setP('typewriter', !P('typewriter')); applyTypography(); } },
            { id: 'rp-next', zh: '下一章', en: 'Next chapter', icon: '→', section: 'Reader', run: function () { var s = state(); if (s) Reader.setChapter(s.chapter + 1); } },
            { id: 'rp-prev', zh: '上一章', en: 'Previous chapter', icon: '←', section: 'Reader', run: function () { var s = state(); if (s) Reader.setChapter(s.chapter - 1); } }
        ].forEach(UI.registerCommand);
    }

    /* ---------------- 事件绑定 ---------------- */
    function bindEvents() {
        window.addEventListener('readerBookLoaded', function () {
            searchIndex = null;
            applyTypography();
            updateProgress();
            setTimeout(restoreScrollPos, 260);
            if (dock) dock.classList.add('visible');
        });
        window.addEventListener('readerChapterChanged', function () {
            updateProgress(); flashPageAnim();
            setTimeout(updateCurrentPara, 120);
        });
        window.addEventListener('readerQuoteRequest', function (e) { showQuote(e.detail && e.detail.text); });
        window.addEventListener('langChanged', function () {
            if (drawer && drawer.classList.contains('open')) drawer.classList.remove('open');
            updateProgress();
        });
        doc.addEventListener('keydown', function (e) {
            var tag = ((e.target && e.target.tagName) || '').toLowerCase();
            var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault(); openSearch(); return;
            }
            if (typing) return;
            if (e.key === ' ') { e.preventDefault(); scrollPage(e.shiftKey ? -1 : 1); return; }
            if (e.key === 'j' || e.key === 'J') { e.preventDefault(); scrollPage(1); return; }
            if (e.key === 'k' || e.key === 'K') { e.preventDefault(); scrollPage(-1); return; }
            if (e.key === 'Home') { e.preventDefault(); Reader.setChapter(0); return; }
            if (e.key === 'End') { var s = state(); if (s) Reader.setChapter(s.chapters - 1); }
        });
        var sc = scroller();
        if (sc) sc.addEventListener('scroll', onScroll, { passive: true });
        doc.addEventListener('visibilitychange', function () { if (!doc.hidden && P('wakeLock')) applyWakeLock(); });
        Bus.on('storage', function (p) {
            if (p.self) return;
            if (p.key && p.key.indexOf('notes_') === 0) {
                try { Reader.renderNotesPanel(); Reader.renderContent(); } catch (e) { warn('syncNotes', e); }
            }
            if (p.key === 'daily') updateProgress();
        });
        initReminders();
        initTranslate();
        initGestures();
        applyWakeLock();
    }

    /* ---------------- 初始化 ---------------- */
    function init() {
        applyTypography();
        buildDock();
        renderSpeechBar();
        bindEvents();
        registerCommands();
        updateProgress();
        if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
            window.speechSynthesis.addEventListener('voiceschanged', function () { if (speechBar && speechBar.classList.contains('open')) renderSpeechBar(); });
        }
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();

    window.ReaderPlus = {
        pickHighlight: pickHighlight,
        openSearch: openSearch,
        showSettings: showSettings,
        showXray: showXray,
        showQuote: showQuote,
        startSpeech: startSpeech,
        stopSpeech: stopSpeech,
        updateProgress: updateProgress,
        applyTypography: applyTypography,
        weekStats: weekStats
    };
})();
