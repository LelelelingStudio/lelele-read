/* =========================================================
   bible-tools.js — 圣经阅读页工具层
   搜索 / 范围复制 / 导出 / 笔记 / 自定义背景 / 更新日志 / 单节操作
   依赖 bible.js 暴露的 window.LeleleBible
   ========================================================= */
(function () {
    'use strict';

    var win = window;
    var doc = document;

    function B() { return win.LeleleBible; }
    function el(id) { return doc.getElementById(id); }
    function t(zh, en) { return B() ? B().t(zh, en) : zh; }
    function esc(s) { return B() ? B().esc(s) : String(s == null ? '' : s); }
    function Store() { return B() && B().Store; }
    function toast(msg) { if (B()) B().toast(msg); }

    /* ---------------- 笔记数据 ---------------- */
    var NOTE_KEY = 'bible_notes';
    var TYPES = ['bookmarks', 'highlights', 'annotations'];
    var notes = readNotes();

    function readNotes() {
        var st = Store();
        var d = st ? st.get(NOTE_KEY, null) : null;
        if (!d || typeof d !== 'object') d = {};
        TYPES.forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
        return d;
    }
    function writeNotes() {
        var st = Store();
        if (st) st.set(NOTE_KEY, notes);
    }
    function same(x, order, chap, verse) {
        return x && x.order === order && x.chap === chap && x.verse === verse;
    }
    function find(type, order, chap, verse) {
        var list = notes[type];
        for (var i = 0; i < list.length; i++) {
            if (same(list[i], order, chap, verse)) return i;
        }
        return -1;
    }
    function verseText(order, chap, verse) {
        var pos = B() && B().getPosition();
        var ch = (pos && pos.order === order && pos.chapter === chap) ? B().getChapter() : null;
        if (ch && ch.paragraphs) return ch.paragraphs[verse - 1] || '';
        return '';
    }
    function getNoteState(order, chap, verse) {
        return {
            bookmark: find('bookmarks', order, chap, verse) !== -1,
            highlight: find('highlights', order, chap, verse) !== -1,
            annotation: (function () {
                var i = find('annotations', order, chap, verse);
                return i === -1 ? '' : (notes.annotations[i].note || '');
            })()
        };
    }
    function toggle(type, order, chap, verse) {
        var i = find(type, order, chap, verse);
        if (i !== -1) notes[type].splice(i, 1);
        else notes[type].push({ order: order, chap: chap, verse: verse, text: verseText(order, chap, verse) });
        writeNotes();
        B().refreshNotes();
        toast(i !== -1 ? t('已移除', 'Removed') : t('已标记', 'Saved'));
        return i === -1;
    }
    function toggleBookmark(order, chap, verse) { return toggle('bookmarks', order, chap, verse); }
    function toggleHighlight(order, chap, verse) { return toggle('highlights', order, chap, verse); }
    function setAnnotation(order, chap, verse, text) {
        var i = find('annotations', order, chap, verse);
        text = String(text || '').trim();
        if (!text) {
            if (i !== -1) notes.annotations.splice(i, 1);
        } else if (i !== -1) {
            notes.annotations[i].note = text;
        } else {
            notes.annotations.push({ order: order, chap: chap, verse: verse, text: verseText(order, chap, verse), note: text });
        }
        writeNotes();
        B().refreshNotes();
        toast(text ? t('批注已保存', 'Note saved') : t('批注已删除', 'Note removed'));
    }

    /* ---------------- 弹层基础 ---------------- */
    function openModal(title, body, foot, onMount) {
        var ov = el('bbOverlay'), m = el('bbModal');
        if (!ov || !m) return null;
        m.innerHTML = '<div class="bb-modal-head"><h3>' + esc(title) + '</h3>' +
            '<button type="button" class="bb-x" data-close aria-label="' + esc(t('关闭', 'Close')) + '">×</button></div>' +
            '<div class="bb-modal-body">' + body + '</div>' +
            (foot ? '<div class="bb-modal-foot">' + foot + '</div>' : '');
        ov.hidden = false;
        m.onclick = function (e) {
            if (e.target && e.target.closest && e.target.closest('[data-close]')) closeModal();
        };
        if (onMount) onMount(m);
        return m;
    }
    function closeModal() { var ov = el('bbOverlay'); if (ov) ov.hidden = true; }
    function closeSheet() {
        var s = el('bbSheet'), mask = el('bbSheetMask');
        if (s) s.hidden = true;
        if (mask) mask.hidden = true;
    }
    function openSheet(html, onMount) {
        var s = el('bbSheet'), mask = el('bbSheetMask');
        if (!s || !mask) return null;
        s.innerHTML = html;
        s.hidden = false; mask.hidden = false;
        if (onMount) onMount(s);
        return s;
    }

    /* ---------------- 文本工具 ---------------- */
    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
        }
        return Promise.resolve(legacyCopy(text));
    }
    function legacyCopy(text) {
        var ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        doc.body.appendChild(ta); ta.select();
        try { doc.execCommand('copy'); } catch (e) { /* 忽略 */ }
        ta.remove();
    }
    function download(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = doc.createElement('a');
        a.href = url; a.download = filename;
        doc.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    }
    function safeName(name) { return String(name).replace(/[\\/:*?"<>|]/g, '_'); }
    function bookOptions(selected) {
        return B().getBooks().map(function (b) {
            return '<option value="' + b.order + '"' + (b.order === selected ? ' selected' : '') + '>' +
                esc(b.title_zh) + '</option>';
        }).join('');
    }
    function buildRange(order, fromChap, toChap, fromVerse, toVerse, withTitle, withVerseNo) {
        return B().getBookData(order).then(function (data) {
            var meta = B().getBook(order);
            var lines = [], chapters = [];
            if (withTitle) lines.push(meta ? meta.title_zh : '');
            for (var c = fromChap; c <= toChap; c++) {
                var ch = data.chapters[c - 1];
                if (!ch) continue;
                var paras = ch.paragraphs || [];
                var start = (c === fromChap) ? Math.max(1, fromVerse) : 1;
                var end = (c === toChap) ? Math.min(paras.length, toVerse) : paras.length;
                if (withTitle) lines.push('', (ch.title || t('第 ' + c + ' 章', 'Chapter ' + c)));
                var picked = [];
                for (var v = start; v <= end; v++) {
                    var text = paras[v - 1];
                    if (text === undefined) continue;
                    picked.push(text);
                    lines.push((withVerseNo ? v + ' ' : '') + text);
                }
                chapters.push({ title: ch.title || t('第 ' + c + ' 章', 'Chapter ' + c), paragraphs: picked });
            }
            return { lines: lines, chapters: chapters, title: meta ? meta.title_zh : '' };
        });
    }
    function chapterOptions(count, selected) {
        var out = '';
        for (var i = 1; i <= count; i++) {
            out += '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + i + '</option>';
        }
        return out;
    }

    /* ---------------- 搜索 ---------------- */
    function openSearch() {
        var body = '<div class="bb-row"><div class="bb-field" style="flex:1">' +
            '<input type="text" id="bbSearchInput" autocomplete="off" placeholder="' + esc(t('输入经文关键词…', 'Type a phrase…')) + '"></div>' +
            '<button type="button" class="bb-primary" id="bbSearchGo">' + esc(t('搜索', 'Search')) + '</button></div>' +
            '<p class="bb-hint" id="bbSearchStatus">' + esc(t('将在 66 卷中查找，最多显示 200 条。', 'Searches all 66 books, up to 200 results.')) + '</p>' +
            '<div class="bb-result-list" id="bbSearchResults"></div>';
        openModal(t('搜索经文', 'Search verses'), body, '', function (m) {
            var input = m.querySelector('#bbSearchInput');
            var go = m.querySelector('#bbSearchGo');
            function run() { doSearch(input.value.trim(), m); }
            go.onclick = run;
            input.onkeydown = function (e) { if (e.key === 'Enter') run(); };
            input.focus();
        });
    }
    function doSearch(kw, m) {
        var status = m.querySelector('#bbSearchStatus');
        var box = m.querySelector('#bbSearchResults');
        if (!kw) { status.textContent = t('请输入关键词。', 'Enter a phrase first.'); return; }
        var books = B().getBooks(), idx = 0, results = [], running = true;
        status.textContent = t('正在搜索…', 'Searching…');
        box.innerHTML = '';
        function render() {
            box.innerHTML = results.length ? results.map(function (r) {
                var safe = esc(r.text);
                var marked = safe.split(esc(kw)).join('<mark>' + esc(kw) + '</mark>');
                return '<button type="button" class="bb-result" data-order="' + r.order + '" data-chap="' + r.chap + '" data-verse="' + r.verse + '">' +
                    '<b>' + esc(r.title) + ' ' + r.chap + ':' + r.verse + '</b><span>' + marked + '</span></button>';
            }).join('') : '<div class="bb-empty">' + esc(t('没有找到匹配的经文', 'No matching verses')) + '</div>';
        }
        function batch() {
            if (!running || !doc.body.contains(m)) return;
            var slice = books.slice(idx, idx + 3); idx += 3;
            Promise.all(slice.map(function (b) { return B().getBookData(b.order).catch(function () { return null; }); }))
                .then(function (datas) {
                    datas.forEach(function (d, i) {
                        if (!d || !d.chapters) return;
                        d.chapters.forEach(function (ch, ci) {
                            (ch.paragraphs || []).forEach(function (p, vi) {
                                if (results.length >= 200) return;
                                if (String(p).indexOf(kw) !== -1) {
                                    results.push({ order: slice[i].order, title: slice[i].title_zh, chap: ci + 1, verse: vi + 1, text: p });
                                }
                            });
                        });
                    });
                    render();
                    if (idx < books.length && results.length < 200) {
                        status.textContent = t('已扫描 ' + Math.min(idx, books.length) + ' / 66 卷，找到 ' + results.length + ' 条…',
                            'Scanned ' + Math.min(idx, books.length) + ' / 66 books, ' + results.length + ' hits…');
                        setTimeout(batch, 0);
                    } else {
                        running = false;
                        status.textContent = t('搜索完成，共 ' + results.length + ' 条', 'Done — ' + results.length + ' results');
                    }
                });
        }
        box.onclick = function (e) {
            var n = e.target.closest && e.target.closest('.bb-result');
            if (!n) return;
            B().open(parseInt(n.getAttribute('data-order'), 10), parseInt(n.getAttribute('data-chap'), 10), parseInt(n.getAttribute('data-verse'), 10));
            if (win.innerWidth <= 768) B().setView('read');
            closeModal();
        };
        batch();
    }

    /* ---------------- 范围复制 ---------------- */
    function openCopy() {
        var pos = B().getPosition();
        var meta = B().getBook(pos.order);
        var body = '<div class="bb-field"><label>' + esc(t('书卷', 'Book')) + '</label><select id="bbCopyBook">' + bookOptions(pos.order) + '</select></div>' +
            '<div class="bb-row"><div class="bb-field"><label>' + esc(t('起始章', 'From chapter')) + '</label><select id="bbCopyFromChap">' + chapterOptions(meta.chapterCount, pos.chapter) + '</select></div>' +
            '<div class="bb-field"><label>' + esc(t('起始节', 'From verse')) + '</label><input type="number" id="bbCopyFromVerse" min="1" value="' + pos.verse + '"></div></div>' +
            '<div class="bb-row"><div class="bb-field"><label>' + esc(t('结束章', 'To chapter')) + '</label><select id="bbCopyToChap">' + chapterOptions(meta.chapterCount, pos.chapter) + '</select></div>' +
            '<div class="bb-field"><label>' + esc(t('结束节', 'To verse')) + '</label><input type="number" id="bbCopyToVerse" min="1" value="999"></div></div>' +
            '<div><label class="bb-check"><input type="checkbox" id="bbCopyTitle" checked>' + esc(t('包含书卷与章标题', 'Include titles')) + '</label>' +
            '<label class="bb-check"><input type="checkbox" id="bbCopyVerseNo" checked>' + esc(t('包含节号', 'Include verse numbers')) + '</label></div>' +
            '<p class="bb-hint">' + esc(t('结束节留 999 表示取到该章最后一节。', 'Leave 999 to include the whole last chapter.')) + '</p>';
        openModal(t('复制经文范围', 'Copy a passage'), body,
            '<button type="button" class="bb-ghost" data-close>' + esc(t('取消', 'Cancel')) + '</button>' +
            '<button type="button" class="bb-primary" id="bbCopyGo">' + esc(t('复制', 'Copy')) + '</button>',
            function (m) {
                m.querySelector('#bbCopyGo').onclick = function () {
                    var order = parseInt(m.querySelector('#bbCopyBook').value, 10);
                    var fc = parseInt(m.querySelector('#bbCopyFromChap').value, 10);
                    var tc = parseInt(m.querySelector('#bbCopyToChap').value, 10);
                    var fv = Math.max(1, parseInt(m.querySelector('#bbCopyFromVerse').value, 10) || 1);
                    var tv = Math.max(1, parseInt(m.querySelector('#bbCopyToVerse').value, 10) || 999);
                    if (tc < fc) { toast(t('结束章不能小于起始章', 'Invalid chapter range')); return; }
                    buildRange(order, fc, tc, fv, tv, m.querySelector('#bbCopyTitle').checked, m.querySelector('#bbCopyVerseNo').checked)
                        .then(function (r) {
                            return copyText(r.lines.join('\n')).then(function () {
                                toast(t('已复制 ' + r.lines.length + ' 行', 'Copied ' + r.lines.length + ' lines'));
                                closeModal();
                            });
                        }).catch(function (e) { toast(t('复制失败', 'Copy failed') + ': ' + e.message); });
                };
            });
    }
    function copyVerse(order, chap, verse) {
        B().getBookData(order).then(function (d) {
            var meta = B().getBook(order);
            var text = d.chapters[chap - 1].paragraphs[verse - 1];
            return copyText(meta.title_zh + ' ' + chap + ':' + verse + ' ' + text).then(function () {
                toast(t('已复制该节', 'Verse copied'));
            });
        }).catch(function () { toast(t('复制失败', 'Copy failed')); });
    }

    /* ---------------- 导出 ---------------- */
    function openExport() {
        var pos = B().getPosition();
        var meta = B().getBook(pos.order);
        var body = '<div class="bb-row"><div class="bb-field"><label>' + esc(t('书卷', 'Book')) + '</label><select id="bbExpBook">' + bookOptions(pos.order) + '</select></div>' +
            '<div class="bb-field"><label>' + esc(t('格式', 'Format')) + '</label><select id="bbExpFormat">' +
            '<option value="txt">TXT</option><option value="html">HTML (' + esc(t('可打印', 'printable')) + ')</option><option value="epub">EPUB</option></select></div></div>' +
            '<div class="bb-row"><div class="bb-field"><label>' + esc(t('起始章', 'From chapter')) + '</label><select id="bbExpFrom">' + chapterOptions(meta.chapterCount, 1) + '</select></div>' +
            '<div class="bb-field"><label>' + esc(t('结束章', 'To chapter')) + '</label><select id="bbExpTo">' + chapterOptions(meta.chapterCount, meta.chapterCount) + '</select></div></div>' +
            '<div><label class="bb-check"><input type="checkbox" id="bbExpVerseNo" checked>' + esc(t('包含节号', 'Include verse numbers')) + '</label></div>' +
            '<p class="bb-hint">' + esc(t('默认导出整卷；EPUB 会按章生成目录。', 'Exports the whole book by default; EPUB includes a chapter TOC.')) + '</p>';
        openModal(t('导出经文', 'Export text'), body,
            '<button type="button" class="bb-ghost" data-close>' + esc(t('取消', 'Cancel')) + '</button>' +
            '<button type="button" class="bb-primary" id="bbExpGo">' + esc(t('导出', 'Export')) + '</button>',
            function (m) {
                m.querySelector('#bbExpGo').onclick = function () {
                    var order = parseInt(m.querySelector('#bbExpBook').value, 10);
                    var fc = parseInt(m.querySelector('#bbExpFrom').value, 10);
                    var tc = parseInt(m.querySelector('#bbExpTo').value, 10);
                    var format = m.querySelector('#bbExpFormat').value;
                    var withNo = m.querySelector('#bbExpVerseNo').checked;
                    if (tc < fc) { toast(t('结束章不能小于起始章', 'Invalid chapter range')); return; }
                    buildRange(order, fc, tc, 1, 99999, true, withNo).then(function (r) {
                        var name = safeName(r.title) + '_' + fc + '-' + tc;
                        if (format === 'epub') {
                            var bridge = win.EpubBridge;
                            if (!bridge || !bridge.buildEpubFromBookContent) throw new Error('EPUB bridge unavailable');
                            return bridge.buildEpubFromBookContent({
                                id: 'bible-' + order, title: r.title, chapters: r.chapters,
                                meta: { creator: '了了了读', language: 'zh' }
                            }).then(function (blob) { bridge.downloadBlob(blob, name + '.epub'); });
                        }
                        if (format === 'html') {
                            download(new Blob(['<html><head><meta charset="utf-8"><title>' + esc(r.title) +
                                '</title><style>body{font-family:"Songti SC",Georgia,serif;max-width:720px;margin:40px auto;line-height:1.95;padding:0 20px}h1{text-align:center}@media print{button{display:none}}</style></head><body>' +
                                '<button onclick="window.print()">' + esc(t('打印 / 存为 PDF', 'Print / Save as PDF')) + '</button>' +
                                r.chapters.map(function (ch) { return '<h2>' + esc(ch.title) + '</h2>' + ch.paragraphs.map(function (p, i) { return '<p>' + (withNo ? (i + 1) + ' ' : '') + esc(p) + '</p>'; }).join(''); }).join('') +
                                '</body></html>'], { type: 'text/html;charset=utf-8' }), name + '.html');
                        } else {
                            download(new Blob(['\ufeff' + r.lines.join('\n')], { type: 'text/plain;charset=utf-8' }), name + '.txt');
                        }
                    }).then(function () {
                        toast(t('导出完成', 'Export complete'));
                        closeModal();
                    }).catch(function (e) { toast(t('导出失败', 'Export failed') + ': ' + e.message); });
                };
            });
    }

    /* ---------------- 笔记面板 ---------------- */
    function openNotes() {
        var body = '<div class="bb-note-tabs">' +
            '<button type="button" class="bb-note-tab active" data-tab="bookmarks">' + esc(t('书签', 'Bookmarks')) + '</button>' +
            '<button type="button" class="bb-note-tab" data-tab="highlights">' + esc(t('高亮', 'Highlights')) + '</button>' +
            '<button type="button" class="bb-note-tab" data-tab="annotations">' + esc(t('批注', 'Notes')) + '</button></div>' +
            '<div id="bbNoteList"></div>';
        openModal(t('我的笔记', 'My notes'), body, '', function (m) {
            function render(type) {
                var list = notes[type];
                var box = m.querySelector('#bbNoteList');
                if (!list.length) { box.innerHTML = '<div class="bb-empty">' + esc(t('还没有记录', 'Nothing here yet')) + '</div>'; return; }
                box.innerHTML = list.map(function (x) {
                    var meta = B().getBook(x.order);
                    return '<button type="button" class="bb-note-item" data-order="' + x.order + '" data-chap="' + x.chap + '" data-verse="' + x.verse + '">' +
                        '<small>' + esc(meta ? meta.title_zh : x.order) + ' ' + x.chap + ':' + x.verse + '</small>' +
                        '<p>' + esc(x.text || '') + '</p>' +
                        (x.note ? '<p style="color:var(--bb-accent)">✎ ' + esc(x.note) + '</p>' : '') + '</button>';
                }).join('');
            }
            m.querySelectorAll('.bb-note-tab').forEach(function (btn) {
                btn.onclick = function () {
                    m.querySelectorAll('.bb-note-tab').forEach(function (b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    render(btn.getAttribute('data-tab'));
                };
            });
            m.querySelector('#bbNoteList').onclick = function (e) {
                var n = e.target.closest && e.target.closest('.bb-note-item');
                if (!n) return;
                B().open(parseInt(n.getAttribute('data-order'), 10), parseInt(n.getAttribute('data-chap'), 10), parseInt(n.getAttribute('data-verse'), 10));
                if (win.innerWidth <= 768) B().setView('read');
                closeModal();
            };
            render('bookmarks');
        });
    }

    /* ---------------- 自定义背景 ---------------- */
    function readSkin() {
        var st = Store();
        var raw = st ? st.get('bible_skin', null) : null;
        if (!raw) return { current: '', previous: '' };
        if (typeof raw === 'string') return { current: raw, previous: '' };
        return { current: raw.current || '', previous: raw.previous || '' };
    }
    function writeSkin(state) {
        var st = Store();
        if (st) st.set('bible_skin', state);
    }
    var PALETTE_KEYS = [
        { key: 'paper', zh: '纸白', en: 'Paper', color: '#FAF8F3' },
        { key: 'sepia', zh: '旧纸', en: 'Sepia', color: '#F2E9D8' },
        { key: 'mint', zh: '青苔', en: 'Mint', color: '#EFF5F1' },
        { key: 'rose', zh: '淡粉', en: 'Rose', color: '#F5E8EC' },
        { key: 'sky', zh: '淡蓝', en: 'Sky', color: '#E8EFF4' },
        { key: 'slate', zh: '暖灰', en: 'Slate', color: '#EDEBE6' }
    ];
    function openSkin() {
        var st = Store();
        var body = '<div class="bb-skin-block"><div class="bb-skin-label">' + esc(t('纯色背景', 'Solid colors')) + '</div>' +
            '<div class="bb-skin-colors" id="bbSkinColors">' + PALETTE_KEYS.map(function (k) {
                return '<button type="button" class="bb-swatch bb-skin-swatch" data-palette="' + k.key + '" title="' + esc(k.zh + ' ' + k.en) + '" style="background:' + k.color + '"></button>';
            }).join('') + '</div></div>' +
            '<div class="bb-skin-block"><div class="bb-skin-label">' + esc(t('自定义图片', 'Custom image')) + '</div>' +
            '<input type="file" id="bbSkinFile" class="bb-skin-file" accept="image/*">' +
            '<p class="bb-hint">' + esc(t('建议小于 1.5MB；上传新图会保留上一张，再次上传时旧图不再显示。', 'Under 1.5MB. A new image keeps the previous one as a choice; uploads again removes the older.')) + '</p>' +
            '<div id="bbSkinHistory" style="display:flex;gap:10px;margin-top:12px"></div></div>';
        openModal(t('阅读背景', 'Reading background'), body,
            '<button type="button" class="bb-ghost" id="bbSkinReset">' + esc(t('恢复默认', 'Reset')) + '</button>' +
            '<button type="button" class="bb-primary" data-close>' + esc(t('完成', 'Done')) + '</button>',
            function (m) {
                function renderHistory() {
                    var s = readSkin();
                    var box = m.querySelector('#bbSkinHistory');
                    var html = '<div class="bb-skin-thumb' + (s.current ? ' active' : '') + '" title="' + esc(t('当前背景', 'Current background')) + '">' +
                        (s.current ? '<img alt="" onerror="this.style.visibility=\'hidden\'" src="' + s.current + '">' : '<span>' + esc(t('默认', 'Default')) + '</span>') + '</div>';
                    if (s.previous) {
                        html += '<div class="bb-skin-thumb" data-prev="1" title="' + esc(t('上一张 · 点击恢复', 'Previous · tap to restore')) + '">' +
                            '<img alt="" onerror="this.style.visibility=\'hidden\'" src="' + s.previous + '"><span class="bb-skin-prev">' + esc(t('上一张', 'Prev')) + '</span></div>';
                    }
                    box.innerHTML = html;
                    box.querySelectorAll('[data-prev]').forEach(function (b) {
                        b.onclick = function () {
                            var s2 = readSkin();
                            writeSkin({ current: s2.previous, previous: '' });
                            B().applySkin();
                            renderHistory();
                            toast(t('已恢复上一张背景', 'Restored previous background'));
                        };
                    });
                }
                m.querySelectorAll('#bbSkinColors .bb-skin-swatch').forEach(function (btn) {
                    btn.onclick = function () {
                        B().setPalette(btn.getAttribute('data-palette'));
                        m.querySelectorAll('#bbSkinColors .bb-skin-swatch').forEach(function (x) { x.classList.toggle('active', x === btn); });
                        toast(t('已应用纯色背景', 'Solid color applied'));
                    };
                });
                m.querySelector('#bbSkinFile').onchange = function (e) {
                    var file = e.target.files && e.target.files[0];
                    if (!file) return;
                    if (file.size > 1.5 * 1024 * 1024) { toast(t('图片过大，请换一张', 'Image too large')); return; }
                    var reader = new FileReader();
                    reader.onload = function () {
                        var s = readSkin();
                        writeSkin({ current: reader.result, previous: s.current });
                        B().applySkin();
                        renderHistory();
                        toast(t('背景已更新', 'Background updated'));
                    };
                    reader.readAsDataURL(file);
                };
                m.querySelector('#bbSkinReset').onclick = function () {
                    if (st) st.remove('bible_skin');
                    B().applySkin();
                    renderHistory();
                    toast(t('已恢复默认背景', 'Background reset'));
                };
                renderHistory();
            });
    }

    /* ---------------- 更新日志 ---------------- */
    function openChangelog() {
        var body = '<div class="bb-log-box"><div class="bb-log-list" id="bbLogList">' +
            '<button type="button" class="active">' + esc(t('加载中…', 'Loading…')) + '</button></div>' +
            '<div class="bb-log-detail" id="bbLogDetail">' + esc(t('正在读取更新日志…', 'Loading changelog…')) + '</div></div>';
        openModal(t('更新日志', 'Changelog'), body, '', function (m) {
            fetch('changelog.json?t=' + Date.now()).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }).then(function (list) {
                list = Array.isArray(list) ? list : [];
                var en = B().t('zh', 'en') === 'en';
                var listBox = m.querySelector('#bbLogList');
                var detail = m.querySelector('#bbLogDetail');
                function show(i) {
                    listBox.querySelectorAll('button').forEach(function (b, j) { b.classList.toggle('active', i === j); });
                    var item = list[i] || {};
                    detail.textContent = (en ? item.content_en : item.content_zh) || t('暂无内容', 'No details');
                }
                listBox.innerHTML = list.map(function (x) {
                    return '<button type="button">v' + esc(x.version) + ' · ' + esc(x.date) + '</button>';
                }).join('') || '<button type="button">' + esc(t('暂无记录', 'No entries')) + '</button>';
                listBox.querySelectorAll('button').forEach(function (b, i) { b.onclick = function () { show(i); }; });
                show(0);
            }).catch(function (e) {
                m.querySelector('#bbLogDetail').textContent = t('更新日志加载失败', 'Failed to load changelog') + ': ' + e.message;
            });
        });
    }

    /* ---------------- 译本与版权 ---------------- */
    function openAbout() {
        var body = '<div class="bb-about">' +
            '<p class="bb-about-lead">' + esc(t('了了了读 · 圣经阅读器接入多个公开版权译本，均保留原版权与署名。', 'lelele Read Bible reader ships multiple public-domain translations, with their copyright and attribution preserved.')) + '</p>' +
            '<ul class="bb-trans-list">' +
            '<li><b>' + esc(t('中文和合本（CUV）', 'Chinese Union Version (CUV)')) + '</b><span>' + esc(t('公有领域中文译本', 'Public-domain Chinese translation')) + '</span></li>' +
            '<li><b>' + esc(t('英文标准译本（WEB）', 'World English Bible (WEB)')) + '</b><span>' + esc(t('Public Domain · 来源 eBible.org · 「World English Bible」为 eBible.org 商标', 'Public Domain · from eBible.org · "World English Bible" is a trademark of eBible.org')) + '</span></li>' +
            '</ul>' +
            '<p class="bb-about-note">' + esc(t('我们推荐使用已进入公共领域或采用 CC0 的内容；详情见 ', 'We recommend content in the public domain or under CC0. See ')) +
            '<a href="rules.html" target="_blank" rel="noopener">' + esc(t('投稿与版权规则', 'submission & copyright rules')) + '</a>。</p>' +
            '</div>';
        openModal(t('译本与版权', 'Translations & Copyright'), body,
            '<button type="button" class="bb-primary" data-close>' + esc(t('知道了', 'Got it')) + '</button>');
    }

    /* ---------------- 单节操作 ---------------- */
    function openVerseActions(order, chap, verse) {
        B().getBookData(order).then(function (d) {
            var meta = B().getBook(order);
            var text = (d.chapters[chap - 1].paragraphs || [])[verse - 1] || '';
            var state = getNoteState(order, chap, verse);
            var html = '<h4>' + esc(meta ? meta.title_zh : '') + ' ' + chap + ':' + verse + '</h4>' +
                '<p class="bb-sheet-quote">' + esc(text) + '</p>' +
                '<div class="bb-field"><label>' + esc(t('批注', 'Note')) + '</label><textarea id="bbNoteText" placeholder="' + esc(t('写下你的想法…', 'Write a note…')) + '">' + esc(state.annotation) + '</textarea></div>' +
                '<div class="bb-sheet-actions">' +
                '<button type="button" data-sheet="bookmark">' + esc(state.bookmark ? t('取消书签', 'Remove bookmark') : t('添加书签', 'Bookmark')) + '</button>' +
                '<button type="button" data-sheet="highlight">' + esc(state.highlight ? t('取消高亮', 'Remove highlight') : t('永久高亮', 'Highlight')) + '</button>' +
                '<button type="button" data-sheet="note">' + esc(t('保存批注', 'Save note')) + '</button>' +
                '<button type="button" data-sheet="copy">' + esc(t('复制单节', 'Copy verse')) + '</button>' +
                '<button type="button" data-sheet="share">' + esc(t('分享链接', 'Copy link')) + '</button>' +
                '<button type="button" data-sheet="close">' + esc(t('关闭', 'Close')) + '</button>' +
                '</div>';
            openSheet(html, function (s) {
                s.onclick = function (e) {
                    var n = e.target.closest && e.target.closest('[data-sheet]');
                    if (!n) return;
                    var act = n.getAttribute('data-sheet');
                    if (act === 'bookmark') toggleBookmark(order, chap, verse);
                    else if (act === 'highlight') toggleHighlight(order, chap, verse);
                    else if (act === 'note') setAnnotation(order, chap, verse, s.querySelector('#bbNoteText').value);
                    else if (act === 'copy') copyVerse(order, chap, verse);
                    else if (act === 'share') {
                        var url = location.origin + location.pathname + '?book=' + order + '&chapter=' + chap + '&verse=' + verse;
                        copyText(url).then(function () { toast(t('链接已复制', 'Link copied')); });
                    }
                    if (act === 'bookmark' || act === 'highlight' || act === 'close') closeSheet();
                };
            });
        }).catch(function (e) { toast(t('打开失败', 'Open failed') + ': ' + e.message); });
    }

    /* ---------------- 对外接口 ---------------- */
    win.LeleleBibleTools = {
        openSearch: openSearch, openCopy: openCopy, openExport: openExport,
        openNotes: openNotes, openSkin: openSkin, openChangelog: openChangelog,
        openAbout: openAbout, openVerseActions: openVerseActions,
        getNoteState: getNoteState, toggleBookmark: toggleBookmark,
        toggleHighlight: toggleHighlight, setAnnotation: setAnnotation,
        copyVerse: copyVerse, closeModal: closeModal, closeSheet: closeSheet
    };

    /* ---------------- DOM 绑定 ---------------- */
    doc.addEventListener('DOMContentLoaded', function () {
        var ov = el('bbOverlay');
        if (ov) ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
        var mask = el('bbSheetMask');
        if (mask) mask.addEventListener('click', closeSheet);
        doc.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeModal(); closeSheet(); }
        });
    });
})();
