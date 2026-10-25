/* =========================================
   reader.js - 万能阅读器核心逻辑
   ========================================= */

const Reader = (function() {
    'use strict';

    // ==================== 1. 内部状态与变量 ====================
    let config = {
        bookTitle: '未命名书籍',
        dataUrl: '',
        dataType: 'js', // 'js' 或 'json'
        globalVarName: '', // 如果是 js，全局变量名
        hasVerseNum: true, // 是否显示节号
        showImportExport: true, // 是否显示导入导出
        defaultFontSize: 16,
        defaultFontFamily: "'Noto Serif SC', 'Inter', serif"
    };

    let bookData = null; // 标准化后的全书数据
    let currentChapterIndex = 0;
    let notes = {
        bookmarks: [],
        highlights: [],
        annotations: []
    };
    
    let isDarkMode = false;
    let customBgImage = null;
    let layoutMode = false;

    // DOM 元素引用
    const els = {
        main: null,
        sidebarList: null,
        contentContainer: null,
        notesPanel: null,
        notesList: null,
        bgLayer: null,
        bgOverlay: null
    };

    // 拖拽相关
    let dragTarget = null, dragOffsetX = 0, dragOffsetY = 0;

    // 本地存储键名
    const STORAGE_KEYS = {
        THEME: 'lelele_read_theme',
        FONT_SIZE: 'lelele_read_fontSize',
        FONT_FAMILY: 'lelele_read_fontFamily',
        BG_IMAGE: 'lelele_read_bgImage',
        LAYOUT: 'lelele_read_layout',
        NOTES: 'lelele_read_notes_',
        PROGRESS: 'lelele_read_progress_'
    };

    // ==================== 2. 数据标准化适配器 ====================
    // 无论数据来自哪里，最终都转成 { title, chapters: [{ title, content: [] }] }
    function normalizeData(rawData) {
        if (!rawData) return null;
        
        // 假设标准格式就是有 chapters 数组
        if (rawData.chapters) {
            return {
                title: rawData.title || config.bookTitle,
                chapters: rawData.chapters.map(c => ({
                    title: c.title || c.name || '未命名章节',
                    content: c.content || c.verses || c.paragraphs || []
                }))
            };
        }
        
        // 如果没有标准结构，做简单兜底（比如传入的是数组）
        if (Array.isArray(rawData)) {
            return {
                title: config.bookTitle,
                chapters: [{ title: '正文', content: rawData }]
            };
        }
        return null;
    }

    // 动态加载数据
    async function loadData() {
        return new Promise((resolve, reject) => {
            if (config.dataType === 'json') {
                fetch(config.dataUrl)
                    .then(res => res.json())
                    .then(data => resolve(normalizeData(data)))
                    .catch(reject);
            } else {
                // 动态加载 JS 文件
                const script = document.createElement('script');
                script.src = config.dataUrl;
                script.onload = () => {
                    if (window[config.globalVarName]) {
                        resolve(normalizeData(window[config.globalVarName]));
                    } else {
                        reject(new Error('全局变量未找到: ' + config.globalVarName));
                    }
                };
                script.onerror = reject;
                document.head.appendChild(script);
            }
        });
    }

    // ==================== 3. 渲染系统 ====================
    function renderSidebar() {
        if (!els.sidebarList || !bookData) return;
        const keyword = document.getElementById('readerSearchInput')?.value.trim().toLowerCase() || '';
        
        els.sidebarList.innerHTML = '';
        bookData.chapters.forEach((chap, index) => {
            if (keyword && !chap.title.toLowerCase().includes(keyword)) return;
            
            const div = document.createElement('div');
            div.className = `reader-list-item ${index === currentChapterIndex ? 'active' : ''}`;
            div.textContent = chap.title;
            div.onclick = () => {
                currentChapterIndex = index;
                renderSidebar();
                renderContent();
                saveProgress();
                if (window.innerWidth <= 768) {
                    document.querySelector('.reader-sidebar').classList.remove('open');
                }
            };
            els.sidebarList.appendChild(div);
        });
    }

    function renderContent() {
        if (!els.contentContainer || !bookData) return;
        const chap = bookData.chapters[currentChapterIndex];
        if (!chap) return;

        let html = `<div class="reader-book-title">${bookData.title}</div>`;
        html += `<div class="reader-chapter-title">${chap.title}</div>`;

        chap.content.forEach((text, idx) => {
            const paraId = `para-${idx}`;
            const isHl = notes.highlights.some(h => h.chap === currentChapterIndex && h.para === idx);
            const isBm = notes.bookmarks.some(b => b.chap === currentChapterIndex && b.para === idx);
            const ann = notes.annotations.find(a => a.chap === currentChapterIndex && a.para === idx);

            let paraClass = 'reader-para';
            if (isHl) paraClass += ' is-highlighted';
            if (isBm) paraClass += ' is-bookmarked';

            html += `<div class="${paraClass}" id="${paraId}">`;
            if (config.hasVerseNum) {
                html += `<div class="reader-para-num">${idx + 1}</div>`;
            }
            html += `<div class="reader-para-text">${text}`;
            
            // 悬浮操作按钮
            html += `<span class="reader-para-actions">`;
            html += `<button class="reader-action-btn" onclick="Reader.toggleHighlight(${idx})">${isHl ? '🖍️' : '🖌️'}</button>`;
            html += `<button class="reader-action-btn" onclick="Reader.toggleBookmark(${idx})">${isBm ? '🔖' : '📑'}</button>`;
            html += `<button class="reader-action-btn" onclick="Reader.openNoteModal(${idx})">💬</button>`;
            html += `</span>`;

            html += `</div></div>`;

            // 批注内容
            if (ann) {
                html += `<div class="reader-para-note">${ann.text}</div>`;
            }
        });

        els.contentContainer.innerHTML = html;
        els.contentContainer.parentElement.scrollTop = 0;
    }

    // ==================== 4. 笔记与工具 ====================
    function loadNotes() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.NOTES + config.bookTitle));
            if (saved) notes = saved;
        } catch(e) {}
    }

    function saveNotes() {
        localStorage.setItem(STORAGE_KEYS.NOTES + config.bookTitle, JSON.stringify(notes));
        renderContent();
        renderNotesPanel();
    }

    function renderNotesPanel() {
        if (!els.notesList) return;
        const activeTab = document.querySelector('.reader-notes-tab.active')?.dataset.tab || 'bookmarks';
        els.notesList.innerHTML = '';

        if (activeTab === 'bookmarks') {
            if (notes.bookmarks.length === 0) {
                els.notesList.innerHTML = '<div style="text-align:center;color:var(--read-text-secondary);margin-top:20px;">暂无书签</div>';
                return;
            }
            notes.bookmarks.forEach(b => {
                const div = document.createElement('div');
                div.className = 'reader-note-item';
                div.innerHTML = `<div class="reader-note-title">${bookData.chapters[b.chap].title} - 第${b.para+1}段</div>`;
                div.onclick = () => jumpTo(b.chap, b.para);
                els.notesList.appendChild(div);
            });
        } else {
            if (notes.annotations.length === 0) {
                els.notesList.innerHTML = '<div style="text-align:center;color:var(--read-text-secondary);margin-top:20px;">暂无批注</div>';
                return;
            }
            notes.annotations.forEach(a => {
                const div = document.createElement('div');
                div.className = 'reader-note-item';
                div.innerHTML = `<div class="reader-note-title">${bookData.chapters[a.chap].title} - 第${a.para+1}段</div>
                                 <div class="reader-note-preview">${a.text}</div>`;
                div.onclick = () => jumpTo(a.chap, a.para);
                els.notesList.appendChild(div);
            });
        }
    }

    function jumpTo(chapIdx, paraIdx) {
        currentChapterIndex = chapIdx;
        renderSidebar();
        renderContent();
        setTimeout(() => {
            const el = document.getElementById(`para-${paraIdx}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // 闪烁一下提示位置
                el.style.transition = 'background 0.5s';
                el.style.background = 'var(--read-accent)';
                setTimeout(() => el.style.background = '', 800);
            }
        }, 100);
        if (window.innerWidth > 768) {
            els.notesPanel.classList.remove('open');
        }
    }

    // ==================== 5. 外观与偏好 ====================
    function applyTheme() {
        document.documentElement.classList.toggle('dark-mode', isDarkMode);
        updateBgOverlay();
    }

    function updateBgOverlay() {
        if (els.bgOverlay) {
            els.bgOverlay.className = `reader-bg-overlay ${customBgImage ? (isDarkMode ? 'active-dark' : 'active-light') : ''}`;
        }
        if (els.bgLayer) {
            els.bgLayer.style.backgroundImage = customBgImage ? `url(${customBgImage})` : 'none';
        }
    }

    function setFontSize(size) {
        const s = Math.min(28, Math.max(12, size));
        document.documentElement.style.fontSize = s + 'px';
        localStorage.setItem(STORAGE_KEYS.FONT_SIZE, s);
    }

    function setFontFamily(family) {
        document.body.style.fontFamily = family;
        localStorage.setItem(STORAGE_KEYS.FONT_FAMILY, family);
    }

    function setColorTheme(theme) {
        document.body.setAttribute('data-color-theme', theme);
    }

    function handleBgUpload(file) {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            // 简单压缩
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX = 1000;
                let w = img.width, h = img.height;
                if (w > MAX) { h = h * MAX / w; w = MAX; }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                customBgImage = canvas.toDataURL('image/jpeg', 0.7);
                localStorage.setItem(STORAGE_KEYS.BG_IMAGE, customBgImage);
                updateBgOverlay();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // ==================== 6. 拖拽布局系统 ====================
    function initDragLayout() {
        const draggables = document.querySelectorAll('.reader-draggable');
        const savedLayout = JSON.parse(localStorage.getItem(STORAGE_KEYS.LAYOUT) || '{}');

        draggables.forEach(el => {
            // 恢复位置
            if (savedLayout[el.id]) {
                el.style.left = savedLayout[el.id].left;
                el.style.top = savedLayout[el.id].top;
                el.style.bottom = 'auto';
                el.style.right = 'auto';
            }

            el.addEventListener('mousedown', (e) => {
                if (!layoutMode) return;
                e.preventDefault();
                dragTarget = el;
                const rect = el.getBoundingClientRect();
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;
                el.style.zIndex = 1000;
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragTarget) return;
            let newLeft = e.clientX - dragOffsetX;
            let newTop = e.clientY - dragOffsetY;
            // 边界限制
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - dragTarget.offsetWidth));
            newTop = Math.max(0, Math.min(newTop, window.innerHeight - dragTarget.offsetHeight));
            
            dragTarget.style.left = newLeft + 'px';
            dragTarget.style.top = newTop + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!dragTarget) return;
            // 保存位置
            const newLayout = {};
            document.querySelectorAll('.reader-draggable').forEach(el => {
                newLayout[el.id] = { left: el.style.left, top: el.style.top };
            });
            localStorage.setItem(STORAGE_KEYS.LAYOUT, JSON.stringify(newLayout));
            dragTarget.style.zIndex = '';
            dragTarget = null;
        });
    }

    // ==================== 7. 导入导出功能 ====================
    function exportBook(format) {
        const text = bookData.chapters.map(c => `${c.title}\n\n${c.content.join('\n')}`).join('\n\n');
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${bookData.title}.${format === 'txt' ? 'txt' : 'txt'}`; // 预留多格式
        a.click();
        window.showToast(`已导出为 ${format.toUpperCase()}`);
    }

    function importBook() {
        window.showToast('EPUB / 本地书籍导入功能即将上线');
    }

    // ==================== 8. 初始化入口 ====================
    async function init(userConfig) {
        Object.assign(config, userConfig);
        
        // 获取 DOM
        els.main = document.querySelector('.reader-main');
        els.sidebarList = document.getElementById('readerSidebarList');
        els.contentContainer = document.getElementById('readerContent');
        els.notesPanel = document.getElementById('readerNotesPanel');
        els.notesList = document.getElementById('readerNotesList');
        els.bgLayer = document.getElementById('readerBgLayer');
        els.bgOverlay = document.getElementById('readerBgOverlay');

        // 加载基础偏好
        isDarkMode = document.documentElement.classList.contains('dark-mode');
        const savedSize = localStorage.getItem(STORAGE_KEYS.FONT_SIZE) || config.defaultFontSize;
        setFontSize(savedSize);
        const savedFont = localStorage.getItem(STORAGE_KEYS.FONT_FAMILY) || config.defaultFontFamily;
        setFontFamily(savedFont);
        customBgImage = localStorage.getItem(STORAGE_KEYS.BG_IMAGE);
        updateBgOverlay();

        loadNotes();
        
        // 加载数据
        try {
            bookData = await loadData();
            if (!bookData) throw new Error('数据为空');
            
            // 恢复进度
            const savedProgress = localStorage.getItem(STORAGE_KEYS.PROGRESS + config.bookTitle);
            if (savedProgress) currentChapterIndex = parseInt(savedProgress);

            renderSidebar();
            renderContent();
            renderNotesPanel();
            initDragLayout();
            
            // 暴露全局交互方法给内联 onclick 用
            window.Reader = {
                toggleHighlight: (idx) => {
                    const i = notes.highlights.findIndex(h => h.chap === currentChapterIndex && h.para === idx);
                    if (i !== -1) notes.highlights.splice(i, 1);
                    else notes.highlights.push({ chap: currentChapterIndex, para: idx });
                    saveNotes();
                },
                toggleBookmark: (idx) => {
                    const i = notes.bookmarks.findIndex(b => b.chap === currentChapterIndex && b.para === idx);
                    if (i !== -1) notes.bookmarks.splice(i, 1);
                    else notes.bookmarks.push({ chap: currentChapterIndex, para: idx });
                    saveNotes();
                },
                openNoteModal: (idx) => {
                    const ann = notes.annotations.find(a => a.chap === currentChapterIndex && a.para === idx);
                    const text = prompt('编辑批注:', ann ? ann.text : '');
                    if (text !== null) {
                        const i = notes.annotations.findIndex(a => a.chap === currentChapterIndex && a.para === idx);
                        if (text.trim() === '') {
                            if (i !== -1) notes.annotations.splice(i, 1);
                        } else {
                            if (i !== -1) notes.annotations[i].text = text;
                            else notes.annotations.push({ chap: currentChapterIndex, para: idx, text });
                        }
                        saveNotes();
                    }
                },
                setFontSize,
                setFontFamily,
                setColorTheme,
                toggleLayout: () => {
                    layoutMode = !layoutMode;
                    document.body.classList.toggle('layout-mode', layoutMode);
                    window.showToast(layoutMode ? '布局模式已开启，可拖拽浮窗' : '布局已保存');
                },
                exportBook,
                importBook
            };

        } catch (err) {
            console.error('阅读器加载失败:', err);
            if (els.contentContainer) els.contentContainer.innerHTML = `<div style="text-align:center; padding: 50px;">书籍加载失败，请检查网络或数据配置。</div>`;
        }

        // 绑定侧边栏移动端开关
        const menuToggle = document.getElementById('readerMenuToggle');
        if (menuToggle) {
            menuToggle.onclick = () => {
                document.querySelector('.reader-sidebar').classList.toggle('open');
            };
        }
    }

    function saveProgress() {
        localStorage.setItem(STORAGE_KEYS.PROGRESS + config.bookTitle, currentChapterIndex);
    }

    return {
        init
    };
})();