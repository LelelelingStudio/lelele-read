/* =========================================
   doc.js - 长文档目录生成与滚动联动
   ========================================= */

const DocEngine = (function() {
    'use strict';

    let _toc = { contentId: null, tocContainerId: null };

    // 取当前语言对应的标题文本（避免 zh/en 两个 span 被拼接）
    function headingText(heading) {
        const lang = (window.getLang && window.getLang()) === 'en' ? 'en' : 'zh';
        const target = heading.querySelector('.' + lang + '-inline');
        if (target) return target.textContent.trim();
        // 没有分语言 span 时回退到纯文本
        return heading.textContent.trim();
    }

    // ==================== 1. 自动生成侧边目录 ====================
    function initTOC(contentId, tocContainerId) {
        const content = document.getElementById(contentId);
        const tocContainer = document.getElementById(tocContainerId);
        if (!content || !tocContainer) return;
        _toc = { contentId, tocContainerId };

        // 提取所有 h2 和 h3
        const headings = content.querySelectorAll('h2, h3');
        if (headings.length === 0) {
            if (tocContainer.parentElement) tocContainer.parentElement.style.display = 'none'; // 没标题就隐藏侧边栏
            return;
        }

        const ul = document.createElement('ul');
        ul.className = 'doc-toc-list';

        headings.forEach((heading, index) => {
            // 如果标题没有 id，自动生成一个（保证唯一）
            if (!heading.id) heading.id = `doc-heading-${index}`;

            const li = document.createElement('li');
            li.className = 'doc-toc-item';
            if (heading.tagName.toLowerCase() === 'h3') {
                li.style.paddingLeft = '16px'; // h3 缩进
            }

            const a = document.createElement('a');
            a.className = 'doc-toc-link';
            a.href = `#${heading.id}`;
            a.textContent = headingText(heading);

            // 点击平滑滚动（留出顶部导航高度）
            a.addEventListener('click', (e) => {
                e.preventDefault();
                const target = document.getElementById(heading.id);
                if (!target) return;
                const y = target.getBoundingClientRect().top + window.scrollY - 80;
                window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
            });

            li.appendChild(a);
            ul.appendChild(li);
        });

        tocContainer.innerHTML = '';
        tocContainer.appendChild(ul);

        // 监听滚动高亮
        initScrollSpy();
    }

    // ==================== 2. 滚动高亮当前目录项 ====================
    function initScrollSpy() {
        const content = document.getElementById(_toc.contentId);
        if (!content) return;
        const headings = content.querySelectorAll('h2, h3');
        const links = Array.from(document.querySelectorAll('.doc-toc-link'));
        if (!headings.length) return;

        function onScroll() {
            let currentId = headings[0].id;
            const threshold = 90; // 视口顶部偏移
            headings.forEach(h => {
                if (h.getBoundingClientRect().top - threshold <= 0) currentId = h.id;
            });
            links.forEach(link => {
                link.classList.toggle('active', link.getAttribute('href') === `#${currentId}`);
            });
        }
        window.removeEventListener('scroll', initScrollSpy._handler);
        initScrollSpy._handler = onScroll;
        window.addEventListener('scroll', onScroll);
        onScroll();
    }

    // ==================== 3. 顶部阅读进度条 ====================
    function initProgressBar() {
        const bar = document.querySelector('.doc-progress-bar');
        if (!bar) return;

        window.addEventListener('scroll', () => {
            const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
            const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            const scrolled = (winScroll / height) * 100;
            bar.style.width = scrolled + '%';
        });
    }

    // ==================== 4. 渲染更新日志（关于页用） ====================
    // 用法：<div id="changelogContainer"></div>
    async function renderChangelog(containerId, jsonUrl) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            const res = await fetch(jsonUrl);
            if (!res.ok) throw new Error('加载日志失败');
            const data = await res.json(); // 假设是 [{version, date, changes: []}, ...]

            let html = '<div class="changelog-timeline">';
            data.forEach(item => {
                html += `
                    <div class="changelog-item">
                        <div class="changelog-version">${item.version}</div>
                        <div class="changelog-date">${item.date}</div>
                        <ul class="changelog-list">
                            ${item.changes.map(c => `<li>${c}</li>`).join('')}
                        </ul>
                    </div>
                `;
            });
            html += '</div>';

            container.innerHTML = html;
        } catch (e) {
            console.warn('更新日志加载失败', e);
            container.innerHTML = '<p style="color:var(--text-muted)">暂无更新记录。</p>';
        }
    }

    // ==================== 5. 初始化统一入口 ====================
    function init(options = {}) {
        initProgressBar();

        if (options.tocContentId && options.tocContainerId) {
            // 稍作延迟，确保其他 DOM 和内容渲染完成
            setTimeout(() => {
                initTOC(options.tocContentId, options.tocContainerId);
            }, 100);
        }

        if (options.changelogContainerId && options.changelogUrl) {
            renderChangelog(options.changelogContainerId, options.changelogUrl);
        }

        // 语言切换时重建目录文本
        window.addEventListener('langChanged', () => {
            if (_toc.contentId) initTOC(_toc.contentId, _toc.tocContainerId);
        });
    }

    return {
        init
    };
})();
