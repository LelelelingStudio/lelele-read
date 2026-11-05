/* =========================================================
   reader.js - 了了了读 · 万能阅读器引擎
   数据源只有 JSON：内置书 config.json + 章节 JSON / 外部 JSON / EPUB 解析结果
   EPUB 只是导入导出格式，导入后统一走 normalizeData
   ========================================================= */
const Reader = (function () {
    'use strict';

    const STORAGE_KEYS = {
        THEME: 'lelele_read_theme',
        FONT_SIZE: 'lelele_read_fontSize',
        FONT_FAMILY: 'lelele_read_fontFamily',
        BG_IMAGE: 'lelele_read_bgImage',
        LAYOUT: 'lelele_read_layout',
        NOTES: 'lelele_read_notes_',
        PROGRESS: 'lelele_read_progress_',
        RECENT: 'lelele_read_recent',
        FAVORITES: 'lelele_read_favorites',
        STATS: 'lelele_read_stats'
    };

    let config = {
        bookId: '',
        bookTitle: '未命名书籍',
        configUrl: '',        // 内置书：指向 config.json
        dataUrl: '',          // 共创/外部：指向 BookContent JSON
        bookContent: null,    // 内存数据（EPUB 导入后直接传入）
        hasVerseNum: false,
        showImportExport: true,
        defaultFontSize: 17,
        defaultFontFamily: "'Noto Serif SC', 'Songti SC', 'PingFang SC', serif"
    };

    let bookData = null;
    let configBase = '';
    const chapterFiles = {};
    let currentChapterIndex = 0;
    let notes = { bookmarks: [], highlights: [], annotations: [] };
    let isDarkMode = false;
    let customBgImage = null;
    let layoutMode = false;
    let dragTarget = null, dragOffsetX = 0, dragOffsetY = 0;

    const els = {
        sidebarList: null, contentContainer: null, notesPanel: null,
        notesList: null, bgLayer: null, bgOverlay: null
    };

    function getLang() { return window.getLang ? window.getLang() : 'zh'; }
    function t(zh, en) { return getLang() === 'en' ? en : zh; }
    function toast(msg) { if (window.showToast) window.showToast(msg); else console.log('[Reader] ' + msg); }
    function esc(s) {
        return window.escapeHtml ? window.escapeHtml(s) :
            String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function fetchJson(url, timeout) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout || 8000);
        try {
            const res = await fetch(url, { signal: ctrl.signal });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    }

    /* ==================== 数据归一化 ==================== */
    // 唯一入口：BookContent / Chapter[] / 段落数组 -> {title, chapters:[{title,content,html,meta}]}
    function normalizeData(rawData, fallbackTitle) {
        if (!rawData) return null;
        const title = rawData.title || fallbackTitle || config.bookTitle;
        let chapters = [];

        if (Array.isArray(rawData.chapters)) {
            chapters = rawData.chapters.map((c, i) => ({
                title: c.title || c.name || (t('第 ', 'Chapter ') + (i + 1)),
                content: (c.content || c.verses || c.paragraphs || []).map(String),
                html: c.html || null,
                meta: c.meta || null
            }));
        } else if (Array.isArray(rawData)) {
            chapters = [{
                title: t('正文', 'Text'),
                content: rawData.map(x => typeof x === 'string' ? x : (x.text || x.paragraphs || '')).map(String),
                html: null, meta: null
            }];
        } else if (Array.isArray(rawData.paragraphs)) {
            chapters = [{ title: rawData.title || t('正文', 'Text'), content: rawData.paragraphs.map(String), html: rawData.html || null, meta: null }];
        } else {
            return null;
        }
        return { id: rawData.id || config.bookId, title: title, chapters: chapters };
    }

    // 内置书：config.json 只给目录，章节内容按 file + index 懒加载
    function buildFromConfig(cfg) {
        const list = cfg.chapters || [];
        return {
            id: cfg.id || config.bookId,
            title: cfg.title_zh || config.bookTitle,
            title_en: cfg.title_en || cfg.title_zh || config.bookTitle,
            groups: cfg.groups || [],
            chapters: list.map(c => ({
                title: (getLang() === 'en' ? c.title_en : c.title_zh) || c.title_zh || t('未命名章节', 'Untitled'),
                content: null, html: null, meta: c
            }))
        };
    }

    async function ensureChapterContent(index) {
        const ch = bookData && bookData.chapters[index];
        if (!ch) return;
        if (Array.isArray(ch.content)) return;
        const m = ch.meta;
        if (!m || !m.file) { ch.content = []; return; }

        const url = new URL(m.file, configBase || location.href).href;
        if (!chapterFiles[url]) {
            chapterFiles[url] = fetchJson(url).catch(e => { delete chapterFiles[url]; throw e; });
        }
        const data = await chapterFiles[url];
        const src = Array.isArray(data.chapters) ? data.chapters[m.index] : (Array.isArray(data) ? data[m.index] : null);
        ch.content = src ? (src.paragraphs || src.content || src.verses || []).map(String) : [];
        ch.html = src && src.html ? src.html : null;
    }

    async function ensureAllChapters(onProgress) {
        const total = bookData.chapters.length;
        for (let i = 0; i < total; i += 8) {
            const batch = [];
            for (let j = i; j < Math.min(total, i + 8); j++) batch.push(ensureChapterContent(j).catch(() => { }));
            await Promise.all(batch);
            if (onProgress) onProgress(Math.min(total, i + 8), total);
        }
    }

    /* ==================== 渲染 ==================== */
    function chapterTitle(ch) {
        if (ch.meta) {
            return (getLang() === 'en' ? (ch.meta.title_en || ch.meta.title_zh) : ch.meta.title_zh) || ch.title;
        }
        return ch.title;
    }

    function renderSidebar() {
        if (!els.sidebarList || !bookData) return;
        const keyword = (document.getElementById('readerSearchInput') || {}).value || '';
        const kw = keyword.trim().toLowerCase();
        const frag = document.createDocumentFragment();

        function makeChapterItem(chap) {
            const index = bookData.chapters.indexOf(chap);
            const title = chapterTitle(chap);
            if (kw && title.toLowerCase().indexOf(kw) === -1) return null;
            const div = document.createElement('div');
            div.className = 'reader-list-item' + (index === currentChapterIndex ? ' active' : '');
            div.textContent = title;
            div.onclick = () => setChapter(index);
            return div;
        }

        const groups = (bookData.groups && bookData.groups.length) ? bookData.groups : null;

        if (!groups) {
            // 普通书：平铺章节
            bookData.chapters.forEach(chap => {
                const item = makeChapterItem(chap);
                if (item) frag.appendChild(item);
            });
        } else {
            // 圣经：旧约/新约 -> 卷(66卷) -> 章（可折叠）
            groups.forEach(g => {
                const groupChaps = bookData.chapters.filter(c => c.meta && c.meta.group === g.id);
                if (!groupChaps.length) return;

                const gHeader = document.createElement('div');
                gHeader.className = 'reader-toc-group';
                gHeader.textContent = (getLang() === 'en' ? g.title_en : g.title_zh) || g.title_zh || g.id;
                frag.appendChild(gHeader);

                // 按卷（file）聚类
                const booksMap = {};
                groupChaps.forEach(c => {
                    const file = (c.meta && c.meta.file) || '_';
                    (booksMap[file] = booksMap[file] || []).push(c);
                });
                Object.keys(booksMap).forEach(file => {
                    const bookChaps = booksMap[file].slice().sort((a, b) => (a.meta.index || 0) - (b.meta.index || 0));
                    const bookTitle = bookChaps[0] ? chapterTitle(bookChaps[0]).split(' · ')[0].trim() : file;
                    const bHeader = document.createElement('div');
                    bHeader.className = 'reader-toc-book';
                    bHeader.textContent = bookTitle;
                    frag.appendChild(bHeader);
                    bookChaps.forEach(chap => {
                        const item = makeChapterItem(chap);
                        if (item) { item.classList.add('reader-list-sub'); frag.appendChild(item); }
                    });
                });
            });
        }

        els.sidebarList.innerHTML = '';
        if (!frag.childNodes.length) {
            const empty = document.createElement('div');
            empty.className = 'reader-list-empty';
            empty.textContent = t('没有匹配的章节', 'No matching chapters');
            frag.appendChild(empty);
        }
        els.sidebarList.appendChild(frag);
    }

    function renderContent() {
        if (!els.contentContainer || !bookData) return;
        const chap = bookData.chapters[currentChapterIndex];
        if (!chap) return;

        const title = bookData.title_en && getLang() === 'en' ? bookData.title_en : bookData.title;
        let html = `<div class="reader-book-title">${esc(title)}</div>`;
        html += `<div class="reader-chapter-title">${esc(chapterTitle(chap))}</div>`;

        if (chap.html && !Array.isArray(chap.content)) {
            html += `<div class="reader-para-html">${chap.html}</div>`;
        } else {
            (chap.content || []).forEach((text, idx) => {
                const isHl = notes.highlights.some(h => h.chap === currentChapterIndex && h.para === idx);
                const isBm = notes.bookmarks.some(b => b.chap === currentChapterIndex && b.para === idx);
                const ann = notes.annotations.find(a => a.chap === currentChapterIndex && a.para === idx);
                let paraClass = 'reader-para';
                if (isHl) paraClass += ' is-highlighted';
                if (isBm) paraClass += ' is-bookmarked';

                html += `<div class="${paraClass}" id="para-${idx}">`;
                if (config.hasVerseNum) html += `<div class="reader-para-num">${idx + 1}</div>`;
                html += `<div class="reader-para-text">${esc(text)}`;
                html += `<span class="reader-para-actions">`;
                html += `<button class="reader-action-btn" data-act="highlight" data-idx="${idx}" title="${esc(t('高亮', 'Highlight'))}">${isHl ? '🖍️' : '🖌️'}</button>`;
                html += `<button class="reader-action-btn" data-act="bookmark" data-idx="${idx}" title="${esc(t('书签', 'Bookmark'))}">${isBm ? '🔖' : '📑'}</button>`;
                html += `<button class="reader-action-btn" data-act="note" data-idx="${idx}" title="${esc(t('批注', 'Note'))}">💬</button>`;
                html += `</span></div></div>`;
                if (ann) html += `<div class="reader-para-note">${esc(ann.text)}</div>`;
            });
            if (!chap.content || chap.content.length === 0) {
                html += `<div class="reader-empty">${esc(t('本章暂无内容', 'This chapter is empty'))}</div>`;
            }
        }

        const total = bookData.chapters.length;
        html += `<div class="reader-chapter-nav">`;
        html += `<button data-act="prev" ${currentChapterIndex <= 0 ? 'disabled' : ''}>← ${esc(t('上一章', 'Previous'))}</button>`;
        html += `<span>${currentChapterIndex + 1} / ${total}</span>`;
        html += `<button data-act="next" ${currentChapterIndex >= total - 1 ? 'disabled' : ''}>${esc(t('下一章', 'Next'))} →</button>`;
        html += `</div>`;

        els.contentContainer.innerHTML = html;
        els.contentContainer.querySelectorAll('[data-act]').forEach(btn => {
            btn.addEventListener('click', () => {
                const act = btn.dataset.act, idx = parseInt(btn.dataset.idx, 10);
                if (act === 'prev') return setChapter(currentChapterIndex - 1);
                if (act === 'next') return setChapter(currentChapterIndex + 1);
                if (act === 'highlight') return toggleHighlight(idx);
                if (act === 'bookmark') return toggleBookmark(idx);
                if (act === 'note') return openNoteModal(idx);
            });
        });
        const scroller = els.contentContainer.parentElement;
        if (scroller && scroller.scrollTop !== undefined) scroller.scrollTop = 0;
    }

    async function setChapter(index) {
        if (!bookData || index < 0 || index >= bookData.chapters.length) return;
        currentChapterIndex = index;
        renderSidebar();
        try {
            await ensureChapterContent(index);
        } catch (e) {
            console.warn('[Reader] 章节加载失败', e.message);
            bookData.chapters[index].content = [];
        }
        renderContent();
        saveProgress();
        if (window.innerWidth <= 768) {
            const sb = document.querySelector('.reader-sidebar');
            if (sb) sb.classList.remove('open');
        }
        window.dispatchEvent(new CustomEvent('readerChapterChanged', { detail: { index: index } }));
    }

    /* ==================== 笔记 ==================== */
    function notesKey() { return STORAGE_KEYS.NOTES + (config.bookId || config.bookTitle); }
    function progressKey() { return STORAGE_KEYS.PROGRESS + (config.bookId || config.bookTitle); }

    function loadNotes() {
        try {
            const saved = JSON.parse(localStorage.getItem(notesKey()) || 'null');
            if (saved) notes = Object.assign({ bookmarks: [], highlights: [], annotations: [] }, saved);
        } catch (e) { }
    }
    function saveNotes() {
        try { localStorage.setItem(notesKey(), JSON.stringify(notes)); } catch (e) { }
        renderContent();
        renderNotesPanel();
        window.dispatchEvent(new Event('readerNotesChanged'));
    }

    function renderNotesPanel() {
        if (!els.notesList) return;
        const activeTab = (document.querySelector('.reader-notes-tab.active') || {}).dataset;
        const tab = activeTab ? activeTab.tab : 'bookmarks';
        const list = tab === 'highlights' ? notes.highlights : (tab === 'annotations' ? notes.annotations : notes.bookmarks);
        els.notesList.innerHTML = '';
        if (!list || list.length === 0) {
            els.notesList.innerHTML = `<div class="reader-notes-empty">${esc(t('暂无记录', 'Nothing here yet'))}</div>`;
            return;
        }
        list.forEach(item => {
            const chap = bookData && bookData.chapters[item.chap];
            const div = document.createElement('div');
            div.className = 'reader-note-item';
            const title = chap ? chapterTitle(chap) : t('已删除章节', 'Removed chapter');
            div.innerHTML = `<div class="reader-note-title">${esc(title)} · ${item.para + 1}</div>` +
                (item.text ? `<div class="reader-note-preview">${esc(item.text)}</div>` : '');
            div.onclick = () => jumpTo(item.chap, item.para);
            els.notesList.appendChild(div);
        });
    }

    function jumpTo(chapIdx, paraIdx) {
        setChapter(chapIdx).then(() => {
            setTimeout(() => {
                const el = document.getElementById(`para-${paraIdx}`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.style.transition = 'background 0.5s';
                    el.style.background = 'var(--read-accent, #3C6E71)';
                    setTimeout(() => { el.style.background = ''; }, 800);
                }
            }, 100);
        });
        if (window.innerWidth > 768 && els.notesPanel) els.notesPanel.classList.remove('open');
    }

    function toggleHighlight(idx) {
        const i = notes.highlights.findIndex(h => h.chap === currentChapterIndex && h.para === idx);
        if (i !== -1) notes.highlights.splice(i, 1);
        else notes.highlights.push({ chap: currentChapterIndex, para: idx });
        saveNotes();
    }
    function toggleBookmark(idx) {
        const i = notes.bookmarks.findIndex(b => b.chap === currentChapterIndex && b.para === idx);
        if (i !== -1) notes.bookmarks.splice(i, 1);
        else notes.bookmarks.push({ chap: currentChapterIndex, para: idx });
        saveNotes();
    }
    function openNoteModal(idx) {
        const ann = notes.annotations.find(a => a.chap === currentChapterIndex && a.para === idx);
        const text = prompt(t('编辑批注', 'Edit note'), ann ? ann.text : '');
        if (text === null) return;
        const i = notes.annotations.findIndex(a => a.chap === currentChapterIndex && a.para === idx);
        if (text.trim() === '') { if (i !== -1) notes.annotations.splice(i, 1); }
        else if (i !== -1) notes.annotations[i].text = text;
        else notes.annotations.push({ chap: currentChapterIndex, para: idx, text: text });
        saveNotes();
    }

    /* ==================== 外观与偏好 ==================== */
    function applyTheme() {
        document.documentElement.classList.toggle('dark-mode', isDarkMode);
        updateBgOverlay();
    }
    function updateBgOverlay() {
        if (els.bgOverlay) els.bgOverlay.className = 'reader-bg-overlay ' + (customBgImage ? (isDarkMode ? 'active-dark' : 'active-light') : '');
        if (els.bgLayer) els.bgLayer.style.backgroundImage = customBgImage ? `url(${customBgImage})` : 'none';
    }
    function setFontSize(size) {
        const s = Math.min(28, Math.max(12, parseInt(size, 10) || 17));
        document.documentElement.style.setProperty('--reader-font-size', s + 'px');
        try { localStorage.setItem(STORAGE_KEYS.FONT_SIZE, s); } catch (e) { }
        window.dispatchEvent(new CustomEvent('readerFontSizeChanged', { detail: s }));
    }
    function setFontFamily(family) {
        document.documentElement.style.setProperty('--reader-font-family', family);
        try { localStorage.setItem(STORAGE_KEYS.FONT_FAMILY, family); } catch (e) { }
    }
    function setColorTheme(theme) { document.body.setAttribute('data-color-theme', theme); }
    function handleBgUpload(file) {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX = 1000;
                let w = img.width, h = img.height;
                if (w > MAX) { h = h * MAX / w; w = MAX; }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                customBgImage = canvas.toDataURL('image/jpeg', 0.7);
                try { localStorage.setItem(STORAGE_KEYS.BG_IMAGE, customBgImage); } catch (err) { }
                updateBgOverlay();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    /* ==================== 拖拽（pointer + 防重叠 + 落盘节流） ==================== */
    function initDragLayout() {
        const items = Array.from(document.querySelectorAll('.reader-draggable'));
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.LAYOUT) || '{}'); } catch (e) { }

        items.forEach(el => {
            if (saved[el.id]) {
                el.style.left = saved[el.id].left;
                el.style.top = saved[el.id].top;
                el.style.right = 'auto';
                el.style.bottom = 'auto';
            }
            el.addEventListener('pointerdown', e => {
                if (!layoutMode) return;
                const tag = (e.target.tagName || '').toLowerCase();
                if (tag === 'button' || tag === 'input' || tag === 'select') return;
                e.preventDefault();
                const rect = el.getBoundingClientRect();
                dragTarget = el;
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;
                el.style.zIndex = '1000';
                el.setPointerCapture(e.pointerId);
            });
        });

        document.addEventListener('pointermove', e => {
            if (!dragTarget) return;
            const w = dragTarget.offsetWidth, h = dragTarget.offsetHeight;
            const left = Math.max(0, Math.min(e.clientX - dragOffsetX, window.innerWidth - w));
            const top = Math.max(0, Math.min(e.clientY - dragOffsetY, window.innerHeight - h));
            dragTarget.style.left = left + 'px';
            dragTarget.style.top = top + 'px';
            dragTarget.style.right = 'auto';
            dragTarget.style.bottom = 'auto';
        });

        document.addEventListener('pointerup', () => {
            if (!dragTarget) return;
            avoidOverlap(dragTarget, items);
            dragTarget.style.zIndex = '';
            dragTarget = null;
            const out = {};
            document.querySelectorAll('.reader-draggable').forEach(el => {
                if (el.style.left && el.style.top) out[el.id] = { left: el.style.left, top: el.style.top };
            });
            try { localStorage.setItem(STORAGE_KEYS.LAYOUT, JSON.stringify(out)); } catch (e) { }
        });
    }

    function avoidOverlap(el, items) {
        const r = el.getBoundingClientRect();
        for (const other of items) {
            if (other === el) continue;
            const o = other.getBoundingClientRect();
            const hit = !(r.right < o.left || r.left > o.right || r.bottom < o.top || r.top > o.bottom);
            if (!hit) continue;
            const nextTop = Math.min(o.bottom + 8, window.innerHeight - r.height);
            el.style.top = Math.max(0, nextTop) + 'px';
            r.top = nextTop; r.bottom = nextTop + r.height;
        }
    }

    /* ==================== 导出 / 导入 ==================== */
    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function getBookContent() {
        if (!bookData) return null;
        return {
            id: bookData.id || config.bookId,
            title: bookData.title,
            chapters: bookData.chapters.map(ch => ({
                title: chapterTitle(ch),
                paragraphs: (ch.content || []).map(String),
                html: ch.html || null
            }))
        };
    }

    async function exportBook(format) {
        if (!bookData) { toast(t('书籍尚未加载', 'Book not loaded')); return; }
        const fmt = (format || 'txt').toLowerCase();
        try {
            if (['epub', 'html', 'json'].indexOf(fmt) !== -1) {
                toast(t('正在准备全书内容…', 'Preparing all chapters…'));
                await ensureAllChapters();
            }

            if (fmt === 'epub') {
                if (!window.EpubBridge) throw new Error(t('EPUB 组件未加载', 'EPUB component not loaded'));
                const blob = await window.EpubBridge.buildEpubFromBookContent(getBookContent());
                downloadBlob(blob, safeName(bookData.title) + '.epub');
                toast(t('EPUB 已生成并下载', 'EPUB generated'));
                return;
            }
            if (fmt === 'json') {
                downloadBlob(new Blob([JSON.stringify(getBookContent(), null, 2)], { type: 'application/json;charset=utf-8' }), safeName(bookData.title) + '.json');
                toast(t('JSON 已导出', 'JSON exported'));
                return;
            }
            if (fmt === 'html') {
                const body = getBookContent().chapters.map(c =>
                    `<section><h2>${esc(c.title)}</h2>${(c.paragraphs || []).map(p => `<p>${esc(p)}</p>`).join('')}</section>`).join('\n');
                const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><title>${esc(bookData.title)}</title><style>body{max-width:42rem;margin:3rem auto;padding:0 1.2rem;font-family:"Noto Serif SC",Songti SC,serif;line-height:2;font-size:17px;color:#1F2933}h1{font-size:28px}h2{margin-top:3rem;color:#2F5D62}p{margin:.8rem 0}</style></head><body><h1>${esc(bookData.title)}</h1>${body}</body></html>`;
                downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), safeName(bookData.title) + '.html');
                toast(t('HTML 已导出', 'HTML exported'));
                return;
            }
            const text = getBookContent().chapters.map(c => `${c.title}\n\n${(c.paragraphs || []).join('\n')}`).join('\n\n');
            downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), safeName(bookData.title) + '.txt');
            toast(t('TXT 已导出', 'TXT exported'));
        } catch (e) {
            console.warn('[Reader] 导出失败', e.message);
            toast(t('导出失败：', 'Export failed: ') + e.message);
        }
    }

    function safeName(s) { return String(s || 'book').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60); }

    function importBook() {
        let input = document.getElementById('readerImportInput');
        if (!input) {
            input = document.createElement('input');
            input.type = 'file';
            input.id = 'readerImportInput';
            input.accept = '.epub,.json,application/epub+zip,application/json';
            input.style.display = 'none';
            document.body.appendChild(input);
            input.addEventListener('change', () => {
                const file = input.files && input.files[0];
                if (file) handleImportFile(file);
                input.value = '';
            });
        }
        input.click();
    }

    async function handleImportFile(file) {
        const limit = (window.EpubBridge && window.EpubBridge.MAX_SIZE) || 20 * 1024 * 1024;
        if (file.size > limit) { toast(t('文件超过 20MB，请先精简', 'File exceeds 20MB')); return; }
        toast(t('正在解析…', 'Parsing…'));
        try {
            let content;
            if (/\.json$/i.test(file.name)) {
                content = JSON.parse(await file.text());
            } else {
                if (!window.EpubBridge) throw new Error(t('EPUB 组件未加载', 'EPUB component not loaded'));
                content = await window.EpubBridge.parseEpubToBookContent(file);
            }
            await setBookContent(content, safeName(file.name.replace(/\.[^.]+$/, '')));
            toast(t('导入成功，已开始阅读', 'Imported, happy reading'));
        } catch (e) {
            console.warn('[Reader] 导入失败', e.message);
            toast(t('导入失败：', 'Import failed: ') + e.message);
        }
    }

    async function setBookContent(content, id) {
        collectEls();
        const normalized = normalizeData(content, (content && content.title) || id);
        if (!normalized) throw new Error(t('无法识别的数据格式', 'Unrecognized data format'));
        config.bookId = 'local_' + (id || content.id || Date.now());
        config.bookTitle = normalized.title;
        config.configUrl = '';
        config.dataUrl = '';
        configBase = '';
        Object.keys(chapterFiles).forEach(k => delete chapterFiles[k]);
        bookData = normalized;
        currentChapterIndex = 0;
        loadNotes();
        renderSidebar();
        await setChapter(0);
        renderNotesPanel();
        startReadingClock();
        window.dispatchEvent(new CustomEvent('readerBookLoaded', {
            detail: { id: config.bookId, title: normalized.title, chapters: normalized.chapters.length, imported: true }
        }));
    }

    /* ==================== 初始化 ==================== */
    function collectEls() {
        els.sidebarList = document.getElementById('readerSidebarList');
        els.contentContainer = document.getElementById('readerContent');
        els.notesPanel = document.getElementById('readerNotesPanel');
        els.notesList = document.getElementById('readerNotesList');
        els.bgLayer = document.getElementById('readerBgLayer');
        els.bgOverlay = document.getElementById('readerBgOverlay');
    }

    async function init(userConfig) {
        Object.assign(config, userConfig || {});
        if (!config.bookId) config.bookId = config.bookTitle || 'book';
        collectEls();

        isDarkMode = document.documentElement.classList.contains('dark-mode');
        setFontSize(localStorage.getItem(STORAGE_KEYS.FONT_SIZE) || config.defaultFontSize);
        setFontFamily(localStorage.getItem(STORAGE_KEYS.FONT_FAMILY) || config.defaultFontFamily);
        try { customBgImage = localStorage.getItem(STORAGE_KEYS.BG_IMAGE); } catch (e) { }
        updateBgOverlay();
        loadNotes();

        try {
            if (config.bookContent) {
                bookData = normalizeData(config.bookContent, config.bookTitle);
                configBase = '';
            } else if (config.configUrl) {
                const cfg = await fetchJson(config.configUrl);
                configBase = new URL('.', new URL(config.configUrl, location.href)).href;
                bookData = buildFromConfig(cfg);
            } else if (config.dataUrl) {
                bookData = normalizeData(await fetchJson(config.dataUrl), config.bookTitle);
            } else {
                throw new Error(t('未配置书籍数据源', 'No book data source configured'));
            }
            if (!bookData) throw new Error(t('数据格式无法识别', 'Unrecognized data format'));

            const saved = parseInt(localStorage.getItem(progressKey()) || '0', 10);
            if (saved >= 0 && saved < bookData.chapters.length) currentChapterIndex = saved;

            renderSidebar();
            await setChapter(currentChapterIndex);
            renderNotesPanel();
            startReadingClock();
            initDragLayout();

            window.dispatchEvent(new CustomEvent('readerBookLoaded', {
                detail: { id: config.bookId, title: bookData.title, chapters: bookData.chapters.length, imported: false }
            }));
        } catch (err) {
            console.warn('[Reader] 加载失败', err.message);
            if (els.contentContainer) {
                els.contentContainer.innerHTML = `<div class="reader-empty">${esc(t('书籍加载失败，请检查网络或数据配置。', 'Failed to load the book. Check your connection or data source.'))}<br><small>${esc(err.message)}</small></div>`;
            }
        }

        const menuToggle = document.getElementById('readerMenuToggle');
        if (menuToggle) menuToggle.onclick = () => {
            const sb = document.querySelector('.reader-sidebar');
            if (sb) sb.classList.toggle('open');
        };
        const search = document.getElementById('readerSearchInput');
        if (search) search.addEventListener('input', renderSidebar);

        document.querySelectorAll('.reader-notes-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.reader-notes-tab').forEach(x => x.classList.remove('active'));
                tab.classList.add('active');
                renderNotesPanel();
            });
        });

        window.addEventListener('langChanged', () => { renderSidebar(); renderContent(); });
        window.addEventListener('themeChanged', () => {
            isDarkMode = document.documentElement.classList.contains('dark-mode');
            updateBgOverlay();
        });
        document.addEventListener('keydown', e => {
            if (/input|textarea/i.test((e.target.tagName || ''))) return;
            if (e.key === 'ArrowRight') setChapter(currentChapterIndex + 1);
            if (e.key === 'ArrowLeft') setChapter(currentChapterIndex - 1);
        });
    }

    function saveProgress() {
        try { localStorage.setItem(progressKey(), String(currentChapterIndex)); } catch (e) { }
        recordRecent();
    }

    /* ---------- 最近阅读 / 收藏 / 阅读时长（面向读者） ---------- */
    function getLS(key, fallback) {
        try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
    }
    function setLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { } }

    function recordRecent() {
        if (!bookData || !bookData.chapters) return;
        const id = config.bookId || bookData.id;
        if (!id || id === 'empty' || String(id).indexOf('local_') === 0) return;
        const list = getLS(STORAGE_KEYS.RECENT, []);
        const arr = Array.isArray(list) ? list : [];
        const entry = {
            id: id,
            title: bookData.title || config.bookTitle || '',
            chapter: currentChapterIndex,
            total: bookData.chapters.length,
            ts: Date.now()
        };
        const next = [entry].concat(arr.filter(x => x && x.id !== id)).slice(0, 12);
        setLS(STORAGE_KEYS.RECENT, next);
    }

    function getFavorites() {
        const list = getLS(STORAGE_KEYS.FAVORITES, []);
        return Array.isArray(list) ? list : [];
    }
    function isFavorite() {
        const id = config.bookId || (bookData && bookData.id);
        return getFavorites().some(x => x && x.id === id);
    }
    function toggleFavorite() {
        const id = config.bookId || (bookData && bookData.id);
        if (!id || id === 'empty' || String(id).indexOf('local_') === 0) return false;
        const list = getFavorites();
        const exists = list.some(x => x && x.id === id);
        const next = exists
            ? list.filter(x => x && x.id !== id)
            : [{ id: id, title: (bookData && bookData.title) || config.bookTitle || '', ts: Date.now() }].concat(list);
        setLS(STORAGE_KEYS.FAVORITES, next);
        window.dispatchEvent(new CustomEvent('readerFavoritesChanged', { detail: { id: id, favorite: !exists } }));
        return !exists;
    }

    let readingTimer = null;
    function startReadingClock() {
        if (readingTimer) return;
        readingTimer = setInterval(() => {
            const s = getLS(STORAGE_KEYS.STATS, {});
            s.seconds = (s.seconds || 0) + 30;
            setLS(STORAGE_KEYS.STATS, s);
        }, 30000);
    }

    const api = {
        init, normalizeData, setChapter, renderSidebar, renderContent, renderNotesPanel,
        setBookContent, getBookContent, exportBook, importBook, handleImportFile,
        setFontSize, setFontFamily, setColorTheme, handleBgUpload, applyTheme,
        toggleHighlight, toggleBookmark, openNoteModal, jumpTo,
        isFavorite, toggleFavorite, getFavorites, recordRecent,
        toggleLayout: () => {
            layoutMode = !layoutMode;
            document.body.classList.toggle('layout-mode', layoutMode);
            toast(layoutMode ? t('布局模式已开启，可拖拽浮窗', 'Layout mode on, drag the tools') : t('布局已保存', 'Layout saved'));
        },
        getState: () => ({ bookId: config.bookId, title: bookData ? bookData.title : '', chapter: currentChapterIndex, chapters: bookData ? bookData.chapters.length : 0 })
    };

    window.Reader = api;
    return api;
})();
