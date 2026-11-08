/* =========================================================
   bible.js — 圣经阅读页核心控制器
   依赖：common.js（getLang / setLang / escapeHtml / toggleTheme）
        common-ui.js（Lelele.Store / UI.registerCommand）
        data/bible/books.json + data/bible/chapters/*.json
   数据按需加载，深链可分享到具体卷章节，全部状态存本地。
   ========================================================= */
(function () {
    'use strict';

    var win = window;
    var doc = document;
    var L = win.Lelele;
    var Store = L && L.Store;

    function el(id) { return doc.getElementById(id); }
    function t(zh, en) { return (win.getLang && win.getLang() === 'en') ? en : zh; }
    function esc(s) {
        s = (s === null || s === undefined) ? '' : String(s);
        return win.escapeHtml ? win.escapeHtml(s) : s.replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function Tools() { return win.LeleleBibleTools || {}; }
    function isMobile() { return win.innerWidth <= 768; }

    var S = {
        books: [], order: 1, chapter: 1, verse: 1,
        data: null, cache: {}, keyword: '',
        font: 17, palette: 'paper', view: 'books', loading: false,
        version: 'cn', cacheV: {}, translationMeta: null
    };

    /* ---------------- 译本与音频配置 ---------------- */
    // 译本：cn=中文和合本（默认），web=英文 WEB（公共领域，来源 eBible.org）
    var TRANSLATIONS = [
        { id: 'cn', name_zh: '和合本', name_en: 'CUV' },
        { id: 'web', name_zh: '英文标准', name_en: 'WEB', publicDomain: true, source: 'eBible.org', note: 'World English Bible · Public Domain' }
    ];
    // 新约戏剧化音频由用户独立托管在 surge 子域；每个子域含 manifest.json（base + files 列表）。
    // 运行时合并成「文件名 -> 直链」映射，按当前书卷·章匹配播放。仓库不含任何音频文件。
    // 部署并确认三个子域的 HTTPS 可访问后，把 AUDIO_ENABLED 改为 true 即启用听读。
    var AUDIO_ENABLED = false;
    var AUDIO_MANIFESTS = [
        'https://bibleaudio1.leleleread.surge.sh/manifest.json',
        'https://bibleaudio2.leleleread.surge.sh/manifest.json',
        'https://bibleaudio3.leleleread.surge.sh/manifest.json'
    ];
    var audioMap = {};      // 文件名 -> 完整 URL
    var audioReady = false; // manifest 是否已加载完毕
    var audioEl = null;     // <audio> 单例

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    /* ---------------- 数据 ---------------- */
    function fetchJson(url, ms) {
        return new Promise(function (resolve, reject) {
            var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 9000);
            var opts = ctrl ? { signal: ctrl.signal } : {};
            fetch(url, opts).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function (data) {
                clearTimeout(timer); resolve(data);
            }).catch(function (err) {
                clearTimeout(timer); reject(err);
            });
        });
    }

    function bookByOrder(order) {
        for (var i = 0; i < S.books.length; i++) {
            if (S.books[i].order === order) return S.books[i];
        }
        return null;
    }

    function loadBook(order) {
        var meta = bookByOrder(order);
        if (!meta) return Promise.reject(new Error('book ' + order + ' not found'));
        S.cacheV[order] = S.cacheV[order] || {};
        if (S.cacheV[order][S.version]) return Promise.resolve(S.cacheV[order][S.version]);
        var dir = S.version === 'web' ? 'web/' : 'chapters/';
        return fetchJson('data/bible/' + dir + meta.file).then(function (data) {
            if (!data || !Array.isArray(data.chapters)) throw new Error('bad chapter data');
            S.cacheV[order][S.version] = data;
            return data;
        });
    }

    function metaUrl() {
        return S.version === 'web' ? 'data/bible/web-books.json' : 'data/bible/books.json';
    }
    function loadMeta() {
        return fetchJson(metaUrl()).then(function (raw) {
            S.books = (raw && Array.isArray(raw.books)) ? raw.books : (Array.isArray(raw) ? raw : []);
            S.translationMeta = (raw && !Array.isArray(raw)) ? raw : null;
        });
    }

    /* ---------------- 译本切换 ---------------- */
    function renderVersionSwitch() {
        Array.prototype.forEach.call(doc.querySelectorAll('#bbVersion [data-v]'), function (b) {
            b.classList.toggle('active', b.getAttribute('data-v') === S.version);
        });
    }
    function setVersion(v) {
        if (v !== 'cn' && v !== 'web') return;
        if (v === S.version) return;
        S.version = v;
        if (Store) Store.set('bible_version', v);
        renderVersionSwitch();
        loadMeta().then(function () {
            return openBook(S.order, S.chapter, S.verse, isMobile() ? 'chapters' : 'read');
        }).catch(showError);
    }

    /* ---------------- 听读（外部托管的 WEB 新约戏剧化音频） ---------------- */
    function ensureAudio() {
        if (audioEl) return;
        audioEl = new Audio();
        audioEl.preload = 'none';
        audioEl.addEventListener('timeupdate', function () {
            var pct = audioEl.duration ? (audioEl.currentTime / audioEl.duration * 100) : 0;
            if (el('bbAudioBar')) el('bbAudioBar').style.width = pct + '%';
            if (el('bbAudioTime')) el('bbAudioTime').textContent = fmtTime(audioEl.currentTime) + ' / ' + fmtTime(audioEl.duration);
        });
        audioEl.addEventListener('ended', function () { setAudioPlaying(false); });
        audioEl.addEventListener('error', function () {
            setAudioPlaying(false);
            if (el('bbAudioTitle')) el('bbAudioTitle').textContent = t('音频加载失败', 'Audio failed to load');
        });
        if (AUDIO_ENABLED) loadAudioManifest();
    }
    function fmtTime(s) {
        if (!s || isNaN(s)) return '0:00';
        var m = Math.floor(s / 60), sec = Math.floor(s % 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
    }
    function loadAudioManifest() {
        Promise.all(AUDIO_MANIFESTS.map(function (u) {
            return fetch(u).then(function (r) { return r.ok ? r.json() : null; })
                .then(function (j) {
                    if (!j || !Array.isArray(j.files)) return;
                    var base = j.base || u.replace(/manifest\.json$/, '');
                    if (base && base.charAt(base.length - 1) !== '/') base += '/';
                    j.files.forEach(function (f) { if (!audioMap[f]) audioMap[f] = base + f; });
                }).catch(function () { /* 某子域未就绪则忽略 */ });
        })).then(function () { audioReady = true; updateAudioUI(); });
    }
    function audioFileFor(order, chapter) {
        if (order < 40) return null; // 仅新约（MAT..REV = 40..66）有音频
        var prefix = 'B' + pad2(order - 39) + '___' + pad2(chapter) + '_';
        for (var k in audioMap) { if (k.indexOf(prefix) === 0) return audioMap[k]; }
        return null;
    }
    function updateAudioUI() {
        var box = el('bbAudio');
        if (!box) return;
        var meta = bookByOrder(S.order);
        if (!meta) { box.hidden = true; return; }
        var url = audioReady ? audioFileFor(S.order, S.chapter) : null;
        if (!url) { box.hidden = true; return; }
        box.hidden = false;
        el('bbAudioTitle').textContent = meta.title_zh + ' ' + S.chapter;
        if (audioEl.src !== url) {
            audioEl.src = url;
            if (el('bbAudioBar')) el('bbAudioBar').style.width = '0%';
            if (el('bbAudioTime')) el('bbAudioTime').textContent = '0:00 / 0:00';
            setAudioPlaying(false);
        }
    }
    function setAudioPlaying(p) {
        var btn = el('bbAudioPlay');
        if (btn) btn.textContent = p ? '❙❙' : '▶';
        if (!audioEl) return;
        if (p) audioEl.play().catch(function () { toast(t('音频播放失败', 'Audio failed to play')); });
        else audioEl.pause();
    }
    function toggleAudio() { setAudioPlaying(audioEl && !audioEl.paused); }

    function currentChapter() {
        return S.data && S.data.chapters ? S.data.chapters[S.chapter - 1] : null;
    }
    function verseCount() {
        var ch = currentChapter();
        return ch && ch.paragraphs ? ch.paragraphs.length : 0;
    }

    /* ---------------- 视图 ---------------- */
    function setView(v) {
        S.view = v;
        doc.body.classList.remove('bb-view-books', 'bb-view-chapters', 'bb-view-read');
        doc.body.classList.add('bb-view-' + v);
        Array.prototype.forEach.call(doc.querySelectorAll('#bbMobileNav [data-view]'), function (b) {
            b.classList.toggle('active', b.getAttribute('data-view') === v);
        });
    }

    function renderBooks() {
        var box = el('bbBookList');
        if (!box) return;
        if (!S.books.length) {
            box.innerHTML = '<div class="bb-loading">' + esc(t('正在加载目录…', 'Loading books…')) + '</div>';
            return;
        }
        var kw = S.keyword.trim().toLowerCase();
        var html = '';
        ['old', 'new'].forEach(function (group) {
            var list = S.books.filter(function (b) {
                if (b.testament !== group) return false;
                if (!kw) return true;
                return b.title_zh.toLowerCase().indexOf(kw) !== -1 || String(b.order) === kw;
            });
            if (!list.length) return;
            html += '<div class="bb-group-title">' + esc(group === 'old'
                ? t('旧约 · 39 卷', 'OLD TESTAMENT · 39 BOOKS')
                : t('新约 · 27 卷', 'NEW TESTAMENT · 27 BOOKS')) + '</div>';
            list.forEach(function (b) {
                html += '<button type="button" class="bb-book' + (b.order === S.order ? ' active' : '') +
                    '" data-order="' + b.order + '"><span><span class="bb-book-no">' + b.order +
                    '</span>' + esc(b.title_zh) + '</span><span class="bb-book-meta">' +
                    b.chapterCount + ' ' + esc(t('章', 'ch')) + '</span></button>';
            });
        });
        box.innerHTML = html || '<div class="bb-empty">' + esc(t('没有找到匹配的书卷', 'No matching books')) + '</div>';
        if (el('bbBookCount')) el('bbBookCount').textContent = String(S.books.length);
    }

    function renderChapters() {
        var meta = bookByOrder(S.order);
        var chGrid = el('bbChapGrid');
        var vGrid = el('bbVerseGrid');
        if (!chGrid || !vGrid || !meta) return;
        var html = '';
        for (var i = 1; i <= meta.chapterCount; i++) {
            html += '<button type="button" class="bb-chip' + (i === S.chapter ? ' active' : '') +
                '" data-chapter="' + i + '">' + i + '</button>';
        }
        chGrid.innerHTML = html;
        if (el('bbChapCount')) el('bbChapCount').textContent = meta.chapterCount + ' ' + t('章', 'ch');

        var n = verseCount();
        var vhtml = '';
        for (var j = 1; j <= n; j++) {
            vhtml += '<button type="button" class="bb-chip' + (j === S.verse ? ' active' : '') +
                '" data-verse="' + j + '">' + j + '</button>';
        }
        vGrid.innerHTML = vhtml || '<div class="bb-empty">' + esc(t('选择章节后显示', 'Select a chapter')) + '</div>';
        if (el('bbVerseCount')) el('bbVerseCount').textContent = n + ' ' + t('节', 'v');
    }

    function noteState(v) {
        var fn = Tools().getNoteState;
        return fn ? fn(S.order, S.chapter, v) : {};
    }

    function renderVerses() {
        var box = el('bbVerses');
        var head = el('bbReadHead');
        var foot = el('bbChapFoot');
        var meta = bookByOrder(S.order);
        var ch = currentChapter();
        if (!box || !head || !foot) return;
        if (!meta || !ch) {
            head.innerHTML = '<h1>' + esc(t('选择一卷开始阅读', 'Choose a book to begin')) + '</h1>';
            box.innerHTML = '<div class="bb-empty">' + esc(t('从左侧书卷目录选择', 'Pick a book from the list')) + '</div>';
            foot.innerHTML = '';
            return;
        }
        head.innerHTML = '<h1>' + esc(meta.title_zh) + ' · ' + esc(t('第 ' + S.chapter + ' 章', 'Chapter ' + S.chapter)) +
            '</h1><p>' + esc(t('共 ' + verseCount() + ' 节 · 点击节号可标记与分享', verseCount() + ' verses · tap a verse number to mark or share')) + '</p>';

        var html = '';
        ch.paragraphs.forEach(function (text, i) {
            var v = i + 1;
            var st = noteState(v) || {};
            var cls = 'bb-verse' + (st.bookmark ? ' bb-bookmarked' : '') +
                (st.highlight ? ' bb-highlighted' : '') +
                (st.annotation ? ' bb-marked' : '') +
                (v === S.verse ? ' bb-focused' : '');
            html += '<div class="' + cls + '" data-vrow="' + v + '">' +
                '<span class="bb-vnum" data-act="verse-menu" data-vrow="' + v + '" title="' + esc(t('节操作', 'Verse actions')) + '">' + v + '</span>' +
                '<p class="bb-vtext">' + esc(text) + '</p>' +
                (st.annotation ? '<div class="bb-vnote">' + esc(st.annotation) + '</div>' : '') +
                '<div class="bb-vactions">' +
                '<button type="button" class="bb-vaction" data-va="bookmark" data-vrow="' + v + '">' + esc(st.bookmark ? t('取消书签', 'Remove bookmark') : t('书签', 'Bookmark')) + '</button>' +
                '<button type="button" class="bb-vaction" data-va="highlight" data-vrow="' + v + '">' + esc(st.highlight ? t('取消高亮', 'Remove highlight') : t('高亮', 'Highlight')) + '</button>' +
                '<button type="button" class="bb-vaction" data-va="copy" data-vrow="' + v + '">' + esc(t('复制', 'Copy')) + '</button>' +
                '<button type="button" class="bb-vaction" data-va="more" data-vrow="' + v + '">' + esc(t('更多', 'More')) + '</button>' +
                '</div></div>';
        });
        box.innerHTML = html;
        foot.innerHTML =
            '<button type="button" data-act="prev-chapter"' + (S.chapter <= 1 ? ' disabled' : '') + '>← ' + esc(t('上一章', 'Previous chapter')) + '</button>' +
            '<button type="button" data-act="next-chapter"' + (S.chapter >= meta.chapterCount ? ' disabled' : '') + '>' + esc(t('下一章', 'Next chapter')) + ' →</button>';
        updateCrumb();
        updateFoot();
    }

    function updateCrumb() {
        var meta = bookByOrder(S.order);
        var node = el('bbCrumb');
        if (!node) return;
        if (!meta) { node.textContent = t('圣经 · 66 卷', 'Holy Bible · 66 books'); return; }
        node.innerHTML = '<b>' + esc(meta.title_zh) + '</b> · ' + esc(t('第 ' + S.chapter + ' 章', 'Ch. ' + S.chapter)) +
            ' · ' + esc(t('第 ' + S.verse + ' 节', 'v. ' + S.verse));
    }

    function updateFoot() {
        var meta = bookByOrder(S.order);
        var node = el('bbFootPos');
        if (node && meta) {
            node.textContent = meta.title_zh + ' ' + S.chapter + ':' + S.verse + ' · ' +
                t('共 ' + meta.chapterCount + ' 章', meta.chapterCount + ' chapters');
        }
        if (el('bbFontVal')) el('bbFontVal').textContent = String(S.font);
    }

    /* ---------------- 状态与持久化 ---------------- */
    function save() {
        if (Store) Store.set('bible_progress', { order: S.order, chapter: S.chapter, verse: S.verse });
        try {
            var q = '?book=' + S.order + '&chapter=' + S.chapter + '&verse=' + S.verse + '&v=' + S.version;
            if (win.getLang && win.getLang() === 'en') q += '&lang=en';
            history.replaceState(null, '', location.pathname + q);
        } catch (e) { /* file:// 或隐私模式忽略 */ }
    }

    function restore() {
        var p = new URLSearchParams(location.search);
        var sv = (Store ? Store.get('bible_version', 'cn') : 'cn');
        if (p.get('v') === 'cn' || p.get('v') === 'web') sv = p.get('v');
        S.version = sv;
        var saved = Store ? Store.get('bible_progress', {}) : {};
        var order = parseInt(p.get('book'), 10) || (saved && saved.order) || 1;
        S.order = Math.max(1, Math.min(66, order));
        S.chapter = Math.max(1, parseInt(p.get('chapter'), 10) || (saved && saved.chapter) || 1);
        S.verse = Math.max(1, parseInt(p.get('verse'), 10) || (saved && saved.verse) || 1);
        S.font = Math.max(14, Math.min(26, parseInt(Store ? Store.get('bible_font_size', 17) : 17, 10) || 17));
        S.palette = (Store && Store.get('bible_palette', 'paper')) || 'paper';
    }

    function applyFont() {
        doc.documentElement.style.setProperty('--bb-font', S.font + 'px');
        updateFoot();
    }
    function applyPalette() {
        doc.documentElement.setAttribute('data-bb-palette', S.palette);
    }
    function applySkin() {
        var raw = Store ? Store.get('bible_skin', null) : null;
        var cur = typeof raw === 'string' ? (raw || '') : (raw && raw.current ? raw.current : '');
        if (cur) {
            doc.body.classList.add('bb-custom-bg');
            doc.body.style.backgroundImage = 'url("' + cur + '")';
        } else {
            doc.body.classList.remove('bb-custom-bg');
            doc.body.style.backgroundImage = '';
        }
    }
    function setPalette(p) {
        S.palette = p;
        applyPalette();
        if (Store) Store.set('bible_palette', p);
    }

    function applyLang() {
        Array.prototype.forEach.call(doc.querySelectorAll('[data-zh]'), function (node) {
            node.textContent = t(node.getAttribute('data-zh'), node.getAttribute('data-en') || node.getAttribute('data-zh'));
        });
        Array.prototype.forEach.call(doc.querySelectorAll('[data-ph-zh]'), function (node) {
            node.setAttribute('placeholder', t(node.getAttribute('data-ph-zh'), node.getAttribute('data-ph-en') || node.getAttribute('data-ph-zh')));
        });
        if (el('bbLangBtn')) {
            el('bbLangBtn').textContent = t('EN', '中');
            el('bbLangBtn').title = t('切换 English', '切换到中文');
        }
        renderBooks(); renderChapters(); renderVerses();
    }

    /* ---------------- 打开与跳转 ---------------- */
    function showError(err) {
        var box = el('bbVerses');
        if (!box) return;
        console.warn('[bible] load failed:', err && err.message);
        box.innerHTML = '<div class="bb-empty">' + esc(t('经文加载失败', 'Failed to load the text')) + '<br>' +
            '<button type="button" class="bb-ghost" data-act="retry" style="margin-top:10px">' + esc(t('重试', 'Retry')) + '</button>' +
            ' · <a href="reader.html?book=bible">' + esc(t('回通用阅读器', 'Open universal reader')) + '</a></div>';
    }

    function openBook(order, chapter, verse, initialView) {
        var meta = bookByOrder(order);
        if (!meta) return Promise.resolve();
        S.order = order;
        S.chapter = Math.max(1, Math.min(chapter || 1, meta.chapterCount));
        S.verse = Math.max(1, verse || 1);
        if (isMobile()) setView(initialView || 'chapters');
        renderBooks();
        el('bbVerses').innerHTML = '<div class="bb-loading">' + esc(t('正在读取经文…', 'Loading text…')) + '</div>';
        return loadBook(order).then(function (data) {
            S.data = data;
            var ch = data.chapters[S.chapter - 1] || data.chapters[0];
            if (!ch) throw new Error('chapter not found');
            S.chapter = data.chapters.indexOf(ch) + 1;
            S.verse = Math.max(1, Math.min(S.verse, ch.paragraphs.length));
            renderChapters(); renderVerses();
            el('bbRead').scrollTop = 0;
            save();
            updateAudioUI();
            return data;
        }).catch(showError);
    }

    function goChapter(n) {
        var meta = bookByOrder(S.order);
        if (!meta || n < 1 || n > meta.chapterCount) return;
        S.chapter = n; S.verse = 1;
        renderChapters(); renderVerses();
        el('bbRead').scrollTop = 0;
        save();
    }

    function goVerse(v) {
        var n = verseCount();
        if (!n) return;
        S.verse = Math.max(1, Math.min(v, n));
        renderChapters(); renderVerses();
        if (isMobile()) setView('read');
        var row = el('bbVerses').querySelector('[data-vrow="' + S.verse + '"]');
        if (row) {
            var top = row.offsetTop - el('bbRead').offsetTop - 20;
            el('bbRead').scrollTo ? el('bbRead').scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
                : (el('bbRead').scrollTop = Math.max(0, top));
        }
        save();
    }

    /* ---------------- 交互 ---------------- */
    function bind() {
        doc.addEventListener('click', function (e) {
            var target = e.target;
            if (!target || !target.closest) return;
            var node;

            node = target.closest('[data-va]');
            if (node) {
                var v = parseInt(node.getAttribute('data-vrow'), 10);
                var kind = node.getAttribute('data-va');
                var T = Tools();
                if (kind === 'bookmark' && T.toggleBookmark) T.toggleBookmark(S.order, S.chapter, v);
                else if (kind === 'highlight' && T.toggleHighlight) T.toggleHighlight(S.order, S.chapter, v);
                else if (kind === 'copy' && T.copyVerse) T.copyVerse(S.order, S.chapter, v);
                else if (kind === 'more' && T.openVerseActions) T.openVerseActions(S.order, S.chapter, v);
                else if (T.openVerseActions) T.openVerseActions(S.order, S.chapter, v);
                return;
            }

            node = target.closest('[data-order]');
            if (node) { openBook(parseInt(node.getAttribute('data-order'), 10), 1, 1); return; }

            node = target.closest('[data-chapter]');
            if (node) { goChapter(parseInt(node.getAttribute('data-chapter'), 10)); if (isMobile()) setView('read'); return; }

            node = target.closest('[data-verse]');
            if (node) { goVerse(parseInt(node.getAttribute('data-verse'), 10)); return; }

            node = target.closest('[data-view]');
            if (node) { setView(node.getAttribute('data-view')); return; }

            node = target.closest('[data-v]');
            if (node) { setVersion(node.getAttribute('data-v')); return; }

            node = target.closest('[data-palette]');
            if (node) {
                S.palette = node.getAttribute('data-palette');
                applyPalette();
                if (Store) Store.set('bible_palette', S.palette);
                return;
            }

            node = target.closest('[data-act]');
            if (!node) return;
            var act = node.getAttribute('data-act');
            var T2 = Tools();
            var map = {
                search: function () { if (T2.openSearch) T2.openSearch(); },
                copy: function () { if (T2.openCopy) T2.openCopy(); },
                export: function () { if (T2.openExport) T2.openExport(); },
                notes: function () { if (T2.openNotes) T2.openNotes(); },
                skin: function () { if (T2.openSkin) T2.openSkin(); },
                changelog: function () { if (T2.openChangelog) T2.openChangelog(); },
                'verse-menu': function () { if (T2.openVerseActions) T2.openVerseActions(S.order, S.chapter, parseInt(node.getAttribute('data-vrow'), 10)); },
                'font-plus': function () { S.font = Math.min(26, S.font + 1); applyFont(); if (Store) Store.set('bible_font_size', S.font); },
                'font-minus': function () { S.font = Math.max(14, S.font - 1); applyFont(); if (Store) Store.set('bible_font_size', S.font); },
                'go-top': function () { el('bbRead').scrollTop = 0; },
                theme: function () { if (win.toggleTheme) win.toggleTheme(); },
                retry: function () { openBook(S.order, S.chapter, S.verse); },
                'prev-chapter': function () { goChapter(S.chapter - 1); },
                'next-chapter': function () { goChapter(S.chapter + 1); },
                'audio-toggle': function () { toggleAudio(); },
                'about': function () { if (Tools().openAbout) Tools().openAbout(); }
            };
            if (map[act]) map[act]();
        });

        var search = el('bbBookSearch');
        if (search) {
            var timer = null;
            search.addEventListener('input', function () {
                clearTimeout(timer);
                timer = setTimeout(function () { S.keyword = search.value; renderBooks(); }, 200);
            });
        }
        if (el('bbLangBtn')) {
            el('bbLangBtn').onclick = function () {
                if (win.setLang) win.setLang(win.getLang && win.getLang() === 'zh' ? 'en' : 'zh');
            };
        }
        win.addEventListener('langChanged', function () { applyLang(); save(); });
        win.addEventListener('themeChanged', function () { applySkin(); });
        var read = el('bbRead');
        if (read) {
            read.addEventListener('scroll', function () {
                var h = read.scrollHeight - read.clientHeight;
                var pct = h > 0 ? (read.scrollTop / h) * 100 : 0;
                if (el('bbProgress')) el('bbProgress').style.width = Math.max(0, Math.min(100, pct)) + '%';
            }, { passive: true });
        }
    }

    function registerCommands() {
        if (!L || !L.UI || !L.UI.registerCommand) return;
        [
            { id: 'bible-verse-search', zh: '搜索圣经经文', en: 'Search Bible verses', icon: '⌕', section: t('圣经', 'Bible'), keywords: 'bible verse search 经文 搜索', run: function () { if (Tools().openSearch) Tools().openSearch(); } },
            { id: 'bible-notes', zh: '圣经笔记', en: 'Bible notes', icon: '✎', section: t('圣经', 'Bible'), keywords: 'bible notes 笔记', run: function () { if (Tools().openNotes) Tools().openNotes(); } },
            { id: 'bible-next', zh: '下一章', en: 'Next chapter', icon: '→', section: t('圣经', 'Bible'), keywords: 'bible next chapter 下一章', run: function () { goChapter(S.chapter + 1); } },
            { id: 'bible-prev', zh: '上一章', en: 'Previous chapter', icon: '←', section: t('圣经', 'Bible'), keywords: 'bible previous chapter 上一章', run: function () { goChapter(S.chapter - 1); } }
        ].forEach(L.UI.registerCommand);
    }

    /* ---------------- 对外接口 ---------------- */
    win.LeleleBible = {
        open: openBook,
        goChapter: goChapter,
        goVerse: goVerse,
        getBooks: function () { return S.books.slice(); },
        getBook: bookByOrder,
        getBookData: loadBook,
        getPosition: function () { return { order: S.order, chapter: S.chapter, verse: S.verse }; },
        getChapter: currentChapter,
        getBooksMeta: function () { return S; },
        refreshNotes: function () { renderVerses(); },
        setView: setView,
        applySkin: applySkin,
        setPalette: setPalette,
        t: t,
        esc: esc,
        Store: Store,
        toast: function (msg) { if (win.showToast) win.showToast(msg); },
        save: save,
        setVersion: setVersion,
        getVersion: function () { return S.version; }
    };

    /* ---------------- 启动 ---------------- */
    doc.addEventListener('DOMContentLoaded', function () {
        bind();
        restore();
        applyFont();
        applyPalette();
        applySkin();
        applyLang();

        renderVersionSwitch();
        ensureAudio();

        // 手机首屏：普通进入先看到 66 卷书库；带深链时直接落在阅读视图
        var hadDeepLink = new URLSearchParams(location.search).has('book');
        loadMeta().then(function () {
            if (!S.books.length) throw new Error('empty book list');
            renderBooks();
            return openBook(S.order, S.chapter, S.verse, hadDeepLink ? 'read' : 'books');
        }).catch(function (err) {
            console.warn('[bible] catalog failed:', err && err.message);
            el('bbBookList').innerHTML = '<div class="bb-empty">' +
                esc(t('书卷目录加载失败', 'Failed to load the book list')) +
                '<br><button type="button" class="bb-ghost" data-act="retry" style="margin-top:10px">' + esc(t('重试', 'Retry')) + '</button>' +
                ' · <a href="reader.html?book=bible">' + esc(t('回通用阅读器', 'Open universal reader')) + '</a></div>';
        });
        registerCommands();
        if (new URLSearchParams(location.search).get('act') === 'search') {
            setTimeout(function () { if (Tools().openSearch) Tools().openSearch(); }, 350);
        }
    });
})();
