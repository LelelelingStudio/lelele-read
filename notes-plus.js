/* ============================================================
   notes-plus.js — 阅读笔记增强
   接管 reader.js 的 renderNotesPanel：Markdown 批注、筛选、全文搜索、
   导出笔记、书签命名、回到上次位置、带出处复制
   ============================================================ */
(function () {
    'use strict';
    if (!window.Lelele || !window.Reader) return;

    var L = window.Lelele, Store = L.Store, UI = L.UI, Bus = L.Bus;
    var t = L.t, esc = L.esc, Reader = window.Reader;
    var doc = document;
    function el(id) { return doc.getElementById(id); }
    function node(tag, cls, html) {
        var n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (html !== undefined) n.innerHTML = html;
        return n;
    }
    function st() { try { return Reader.getState(); } catch (e) { return null; } }
    function toast(m) { UI.toast(m); }
    function warn(m, e) { console.warn('[NotesPlus:' + m + ']', (e && e.message) || e); }

    var prefs = Store.get('notes_prefs', {});
    if (!prefs || typeof prefs !== 'object') prefs = {};
    if (prefs.copySource === undefined) prefs.copySource = true;

    /* ---------------- 简易 Markdown ---------------- */
    function markdown(text) {
        var s = esc(String(text || ''));
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        s = s.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
        s = s.replace(/\n/g, '<br>');
        return s;
    }

    /* ---------------- 工具栏 ---------------- */
    var toolbar = null;
    function ensureToolbar() {
        if (toolbar) return toolbar;
        var panel = el('readerNotesPanel'), list = el('readerNotesList');
        if (!panel || !list) return null;
        toolbar = node('div', 'np-toolbar'); toolbar.id = 'npToolbar';
        toolbar.innerHTML =
            '<input type="search" id="npSearch" autocomplete="off" placeholder="' + esc(t('搜索笔记…', 'Search notes…')) + '">' +
            '<select id="npChap"><option value="all">' + esc(t('全部章节', 'All chapters')) + '</option></select>' +
            '<div class="np-actions">' +
            '<button type="button" class="rd-btn" id="npExportMd" title="' + esc(t('导出 Markdown', 'Export Markdown')) + '">MD</button>' +
            '<button type="button" class="rd-btn" id="npExportJson" title="' + esc(t('导出 JSON', 'Export JSON')) + '">JSON</button>' +
            '</div>';
        panel.insertBefore(toolbar, list);
        el('npSearch').addEventListener('input', render);
        el('npChap').addEventListener('change', render);
        el('npExportMd').onclick = function () { exportNotes('md'); };
        el('npExportJson').onclick = function () { exportNotes('json'); };
        return toolbar;
    }

    function fillChapterOptions() {
        var sel = el('npChap'); if (!sel) return;
        var s = st(); if (!s || !s.bookData) return;
        var cur = sel.value;
        sel.innerHTML = '<option value="all">' + esc(t('全部章节', 'All chapters')) + '</option>' +
            s.bookData.chapters.map(function (ch, i) {
                return '<option value="' + i + '">' + esc(ch.title || ('# ' + (i + 1))) + '</option>';
            }).join('');
        if (cur && (cur === 'all' || parseInt(cur, 10) < s.bookData.chapters.length)) sel.value = cur;
    }

    function paraText(chap, para) {
        var s = st();
        if (!s || !s.bookData || !s.bookData.chapters[chap]) return '';
        return String((s.bookData.chapters[chap].content || [])[para] || '');
    }
    function chapterName(i) {
        var s = st();
        return (s && s.bookData && s.bookData.chapters[i] && (s.bookData.chapters[i].title || ('# ' + (i + 1)))) || ('# ' + (i + 1));
    }

    /* ---------------- 笔记列表渲染 ---------------- */
    function render() {
        var list = el('readerNotesList');
        if (!list) return;
        ensureToolbar(); fillChapterOptions();
        var s = st();
        if (!s || !s.bookData) {
            list.innerHTML = '<div class="reader-notes-empty">' + esc(t('书籍尚未加载', 'Book not loaded')) + '</div>';
            return;
        }
        var active = doc.querySelector('.reader-notes-tab.active');
        var tab = active && active.dataset ? (active.dataset.tab || 'bookmarks') : 'bookmarks';
        var key = tab === 'highlights' ? 'highlights' : (tab === 'annotations' ? 'annotations' : 'bookmarks');
        var items = (s.notes[key] || []).slice();
        var kw = ((el('npSearch') || {}).value || '').trim().toLowerCase();
        var chapFilter = ((el('npChap') || {}).value || 'all');

        items = items.filter(function (it) {
            if (chapFilter !== 'all' && String(it.chap) !== String(chapFilter)) return false;
            if (!kw) return true;
            return (chapterName(it.chap) + ' ' + paraText(it.chap, it.para) + ' ' + (it.text || '') + ' ' + (it.label || ''))
                .toLowerCase().indexOf(kw) >= 0;
        });

        if (!items.length) {
            list.innerHTML = '<div class="reader-notes-empty">' + esc(t('暂无记录', 'Nothing here yet')) + '</div>';
            return;
        }
        var frag = doc.createDocumentFragment();
        items.forEach(function (item) {
            var div = node('div', 'np-item');
            var preview = paraText(item.chap, item.para);
            var short = preview.length > 90 ? preview.slice(0, 90) + '…' : preview;
            var marks = '';
            if (item.color) marks += '<span class="np-dot" style="background:' + ({ yellow: '#ffe066', green: '#a7e8b5', pink: '#ffb3c6', blue: '#a8d5ff' }[item.color] || '#ffe066') + '"></span>';
            if (item.style) marks += '<span class="ll-badge">' + esc(item.style) + '</span>';
            div.innerHTML =
                '<div class="np-item-head"><span class="np-where">' + esc(chapterName(item.chap)) + ' · ' + (item.para + 1) + '</span>' + marks +
                '<span class="np-tools">' +
                (key === 'bookmarks' ? '<button type="button" data-np="label" title="' + esc(t('命名', 'Rename')) + '">✎</button>' : '') +
                '<button type="button" data-np="del" title="' + esc(t('删除', 'Delete')) + '">×</button></span></div>' +
                '<div class="np-preview">' + esc(short) + '</div>' +
                (item.label ? '<div class="np-label">🔖 ' + esc(item.label) + '</div>' : '') +
                (item.text ? '<div class="np-md">' + markdown(item.text) + '</div>' : '');
            div.onclick = function (e) {
                if (e.target.closest('[data-np]')) return;
                Reader.jumpTo(item.chap, item.para);
            };
            var labelBtn = div.querySelector('[data-np="label"]');
            if (labelBtn) labelBtn.onclick = function (e) {
                e.stopPropagation();
                var v = prompt(t('给书签起个名字', 'Name this bookmark'), item.label || '');
                if (v === null) return;
                Reader.setBookmarkLabel(item.chap, item.para, v);
            };
            div.querySelector('[data-np="del"]').onclick = function (e) {
                e.stopPropagation();
                var arr = s.notes[key];
                var i = arr.findIndex(function (x) { return x.chap === item.chap && x.para === item.para; });
                if (i < 0) return;
                arr.splice(i, 1);
                Reader.saveNotesExternal();
                if (UI.showUndo) UI.showUndo(t('已删除笔记', 'Note deleted'), function () {
                    arr.splice(i, 0, item); Reader.saveNotesExternal();
                });
            };
            frag.appendChild(div);
        });
        list.innerHTML = '';
        list.appendChild(frag);
    }

    /* ---------------- 21 导出笔记 ---------------- */
    function download(name, content, type) {
        try {
            var blob = new Blob([content], { type: type });
            var a = doc.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = name;
            a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        } catch (e) { warn('download', e); toast(t('导出失败', 'Export failed')); }
    }
    function exportNotes(fmt) {
        var s = st(); if (!s || !s.bookData) { toast(t('书籍尚未加载', 'Book not loaded')); return; }
        var name = (s.title || 'book').replace(/[\\/:*?"<>|]/g, '_');
        if (fmt === 'json') {
            download(name + '-notes.json', JSON.stringify({
                book: s.title, bookId: s.bookId, exportedAt: new Date().toISOString(), notes: s.notes
            }, null, 2), 'application/json');
        } else {
            var md = '# 《' + s.title + '》' + t(' · 阅读笔记', ' · Reading notes') + '\n\n';
            var groups = [
                ['bookmarks', t('书签', 'Bookmarks')],
                ['highlights', t('划线', 'Highlights')],
                ['annotations', t('批注', 'Annotations')]
            ];
            groups.forEach(function (g) {
                md += '## ' + g[1] + '\n\n';
                var arr = s.notes[g[0]] || [];
                if (!arr.length) md += t('_（无）_', '_None_') + '\n\n';
                arr.forEach(function (it) {
                    md += '- **' + chapterName(it.chap) + '** · ' + t('第 ', 'para ') + (it.para + 1) + t('段', '') + '\n';
                    if (it.label) md += '  - ' + t('标记：', 'Label: ') + it.label + '\n';
                    var p = paraText(it.chap, it.para);
                    if (p) md += '  > ' + p.slice(0, 200).replace(/\n/g, '\n  > ') + '\n';
                    if (it.text) md += '\n' + it.text + '\n';
                    md += '\n';
                });
            });
            md += '\n---\n' + t('由了了了读导出 · ', 'Exported from lelele Read · ') + new Date().toLocaleString() + '\n';
            download(name + '-notes.md', md, 'text/markdown;charset=utf-8');
        }
        toast(t('笔记已导出', 'Notes exported'));
    }

    /* ---------------- 27 带出处复制 ---------------- */
    function copyWithSource(text) {
        var s = st();
        var suffix = '\n\n—— 《' + ((s && s.title) || '') + '》 · 了了了读 / lelele Read';
        var out = String(text || '') + suffix;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(out).then(function () { toast(t('已复制（含书名出处）', 'Copied with book source')); })
                .catch(function () { fallbackCopy(out); });
        } else fallbackCopy(out);
    }
    function fallbackCopy(text) {
        try {
            var ta = doc.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            doc.body.appendChild(ta); ta.select(); doc.execCommand('copy'); ta.remove();
            toast(t('已复制（含书名出处）', 'Copied with book source'));
        } catch (e) { toast(t('复制失败', 'Copy failed')); }
    }
    function initCopy() {
        window.addEventListener('readerCopyRequest', function (e) { copyWithSource(e.detail && e.detail.text); });
        doc.addEventListener('copy', function (e) {
            if (!prefs.copySource) return;
            var sel = window.getSelection();
            if (!sel || sel.isCollapsed) return;
            var text = String(sel).trim();
            if (text.length < 20) return;
            var container = el('readerContent');
            if (!container || !sel.anchorNode || !container.contains(sel.anchorNode)) return;
            var s = st();
            var suffix = '\n\n—— 《' + ((s && s.title) || '') + '》 · 了了了读 / lelele Read';
            if (e.clipboardData) {
                e.clipboardData.setData('text/plain', text + suffix);
                e.preventDefault();
                toast(t('已复制（含书名出处）', 'Copied with book source'));
            }
        });
    }

    /* ---------------- 24 回到上次位置 ---------------- */
    var resumeBtn = null;
    function showResume() {
        var s = st(); if (!s || !s.bookData || !s.bookId) return;
        var d = null;
        try { d = JSON.parse(localStorage.getItem('lelele_read_scrollpos_' + s.bookId) || 'null'); } catch (e) { }
        if (!d || typeof d.para !== 'number' || (d.chap === s.chapter && d.para === 0)) return;
        if (!resumeBtn) {
            resumeBtn = node('button', 'np-resume'); resumeBtn.id = 'npResume';
            doc.body.appendChild(resumeBtn);
        }
        resumeBtn.innerHTML = '↩ ' + esc(t('回到上次位置', 'Back to where you left'));
        resumeBtn.hidden = false;
        resumeBtn.onclick = function () {
            resumeBtn.hidden = true;
            Reader.setChapter(d.chap).then(function () {
                setTimeout(function () {
                    var n = el('para-' + d.para);
                    if (n) n.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 160);
            });
        };
        clearTimeout(resumeBtn._timer);
        resumeBtn._timer = setTimeout(function () { resumeBtn.hidden = true; }, 12000);
    }

    /* ---------------- 初始化 ---------------- */
    function init() {
        ensureToolbar();
        initCopy();
        window.addEventListener('readerBookLoaded', function () { fillChapterOptions(); render(); setTimeout(showResume, 400); });
        window.addEventListener('readerChapterChanged', function () { if (toolbar) render(); });
        window.addEventListener('langChanged', function () {
            if (toolbar) {
                el('npSearch').placeholder = t('搜索笔记…', 'Search notes…');
                fillChapterOptions(); render();
            }
        });
        window.addEventListener('readerNotesChanged', function () { if (toolbar) render(); });
        UI.registerCommand({ id: 'np-export-md', zh: '导出本书笔记（Markdown）', en: 'Export notes (Markdown)', icon: '⇩', section: 'Notes', run: function () { exportNotes('md'); } });
        UI.registerCommand({ id: 'np-export-json', zh: '导出本书笔记（JSON）', en: 'Export notes (JSON)', icon: '⇩', section: 'Notes', run: function () { exportNotes('json'); } });
        UI.registerCommand({ id: 'np-open', zh: '打开我的笔记', en: 'Open my notes', icon: '📝', section: 'Notes', run: function () {
            var p = el('readerNotesPanel'); if (p) { p.classList.add('open'); render(); }
        } });
        render();
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();

    window.NotesPlus = {
        render: render,
        exportNotes: exportNotes,
        copyWithSource: copyWithSource,
        markdown: markdown
    };
})();
