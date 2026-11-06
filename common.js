/* =========================================
   common.js - 全站公共逻辑与基建 (优化版)
   ========================================= */

(function() {
    'use strict';

    // ==================== 1. 全局配置项 ====================
    const CONFIG = {
        SITE_URL: 'https://read.leleleling.site',
        AUTHOR_API: 'https://authors.surge.sh/lelelereadauthor.json',
        FEEDBACK_URL: 'https://tally.so/r/pedeGV',
        DEFAULT_LANG: 'zh'
    };

    // ==================== 2. 全局工具函数 ====================
    
    window.getLang = function() {
        return document.documentElement.getAttribute('data-lang') || CONFIG.DEFAULT_LANG;
    };

    window.escapeHtml = function(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    window.showToast = function(message, duration = 3000) {
        let toast = document.getElementById('commonToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'commonToast';
            toast.className = 'common-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        void toast.offsetWidth; 
        toast.classList.add('show');
        
        if (window.toastTimer) clearTimeout(window.toastTimer);
        window.toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    };

    window.leleleTrack = function(eventName, eventData) {
        if (typeof umami !== 'undefined' && umami.track) {
            try { umami.track(eventName, eventData); } catch(e) {}
        } else if (typeof edgemetry !== 'undefined') {
            try { edgemetry(eventName, eventData); } catch(e) {}
        } else {
            console.log(`[Track] ${eventName}`, eventData || '');
        }
    };

    // ==================== 3. 语言与主题系统 ====================
    function initLang() {
        const urlParams = new URLSearchParams(window.location.search);
        const urlLang = urlParams.get('lang');
        const storedLang = localStorage.getItem('lelele_read_lang');
        
        let lang = CONFIG.DEFAULT_LANG;
        if (urlLang === 'en' || urlLang === 'zh') {
            lang = urlLang;
        } else if (storedLang === 'en' || storedLang === 'zh') {
            lang = storedLang;
        } else {
            const navLang = (navigator.language || '').toLowerCase();
            if (navLang.indexOf('zh') === 0) lang = 'zh';
            else if (navLang.indexOf('en') === 0) lang = 'en';
        }
        
        document.documentElement.setAttribute('data-lang', lang);
        document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');
    }

    window.setLang = function(lang) {
        document.documentElement.setAttribute('data-lang', lang);
        document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');
        try { localStorage.setItem('lelele_read_lang', lang); } catch (e) {}
        
        // 【核心修复】统一在此处同步页面上的语言切换按钮 active 状态
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.langBtn === lang);
        });
        
        injectFooter();
        updateFloatToolsLang();
        initManifest(); 
        
        window.dispatchEvent(new Event('langChanged'));
    };

    function initTheme() {
        const storedTheme = localStorage.getItem('lelele_read_theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (storedTheme === 'dark' || (!storedTheme && prefersDark)) {
            document.documentElement.classList.add('dark-mode');
        }

        window.toggleTheme = function() {
            const isDark = document.documentElement.classList.toggle('dark-mode');
            try { localStorage.setItem('lelele_read_theme', isDark ? 'dark' : 'light'); } catch (e) {}
            window.dispatchEvent(new Event('themeChanged'));
        };
    }

    function initManifest() {
        try {
            const lang = getLang();
            const manifestUrl = lang === 'en' ? '/manifest-en.json' : '/manifest-zh.json';
            document.querySelectorAll('link[rel="manifest"]').forEach(el => el.remove());
            
            const link = document.createElement('link');
            link.rel = 'manifest';
            link.href = manifestUrl;
            document.head.appendChild(link);
        } catch (e) {}
    }

    // ==================== 4. 外部数据拉取 ====================
    // 跨域作者总表：5s 超时 + 状态校验 + 失败降级，任何情况下都派发 authorsLoaded，
    // 避免页面一直停在「…」或因为外部域挂起而白屏（借鉴「游」站白屏事故教训，不复用其代码）。
    // 远程作者总表不可用时的本地兜底：保证任何情况下都不会把作者 ID 直接显示给读者
    const AUTHORS_FALLBACK = [
        { id: 1, name_zh: '了了了岭工作室', name_en: 'Leleleling Studio' },
        { id: 'luxun', name_zh: '鲁迅', name_en: 'Lu Xun' },
        { id: '佚名', name_zh: '佚名', name_en: 'Anonymous' },
        { id: '书友们', name_zh: '书友们', name_en: 'Community contributors' }
    ];

    function fetchAuthors() {
        window.AUTHORS_DATA = AUTHORS_FALLBACK.slice();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        fetch(CONFIG.AUTHOR_API + '?t=' + Date.now(), { signal: ctrl.signal })
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(data => {
                const remote = Array.isArray(data) ? data : (data && Array.isArray(data.authors) ? data.authors : []);
                window.AUTHORS_DATA = AUTHORS_FALLBACK.concat(remote);
            })
            .catch(err => {
                console.warn('[read] 作者总表不可用，已降级:', err.message);
                window.AUTHORS_DATA = AUTHORS_FALLBACK.slice();
            })
            .then(() => {
                clearTimeout(timer);
                window.dispatchEvent(new Event('authorsLoaded'));
            });
    }

    // 统一的 JSON 读取工具：超时 + 状态校验，失败抛错交给调用方降级
    window.readFetchJson = function (url, timeout) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout || 8000);
        return fetch(url, { signal: ctrl.signal })
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .finally(() => clearTimeout(timer));
    };

    // ==================== 5. UI 动态注入 ====================
    function injectFooter() {
        const existingFooter = document.querySelector('.common-footer');
        if (existingFooter) existingFooter.remove();
        
        const lang = getLang();
        const suffix = lang === 'en' ? '?lang=en' : '';
        
        const footer = document.createElement('footer');
        footer.className = 'common-footer';
        footer.innerHTML = `
            <div>
                © 2026 <span class="zh-inline">了了了岭工作室 · 了了了读</span><span class="en-inline">Leleleling Studio · lelele Read</span>
            </div>
            <div style="margin-top: 8px;">
                <a href="${CONFIG.SITE_URL}/rules.html${suffix}"><span class="zh-inline">阅读器守则</span><span class="en-inline">Rules</span></a> ｜
                <a href="${CONFIG.SITE_URL}/privacy.html${suffix}"><span class="zh-inline">隐私政策</span><span class="en-inline">Privacy</span></a> ｜
                <a href="${CONFIG.SITE_URL}/copyright.html${suffix}"><span class="zh-inline">版权投诉</span><span class="en-inline">Copyright</span></a>
            </div>
        `;
        
        const placeholder = document.getElementById('footerPlaceholder');
        if (placeholder) {
            placeholder.appendChild(footer);
        } else {
            document.body.appendChild(footer);
        }
    }

    function injectFloatTools() {
        if (document.querySelector('.common-float-tools')) return;
        
        const container = document.createElement('div');
        container.className = 'common-float-tools';
        container.innerHTML = `
            <button class="common-float-btn" id="commonBtnFeedback">💬</button>
            <button class="common-float-btn" id="commonBtnTop">⬆️</button>
        `;
        document.body.appendChild(container);

        const btnTop = document.getElementById('commonBtnTop');
        const btnFeedback = document.getElementById('commonBtnFeedback');
        btnFeedback.classList.add('show');

        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) btnTop.classList.add('show');
            else btnTop.classList.remove('show');
        });
        
        btnTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
        btnFeedback.onclick = () => {
            if (window.leleleOpenFeedback) return window.leleleOpenFeedback();
            if (window.Tally && typeof window.Tally.openPopup === 'function') return window.Tally.openPopup('pedeGV');
            window.open(CONFIG.FEEDBACK_URL, '_blank', 'noopener');
        };

        updateFloatToolsLang();
    }

    function updateFloatToolsLang() {
        const lang = getLang();
        const fbBtn = document.getElementById('commonBtnFeedback');
        const topBtn = document.getElementById('commonBtnTop');
        if (fbBtn) fbBtn.setAttribute('data-tooltip', lang === 'en' ? 'Feedback' : '意见反馈');
        if (topBtn) topBtn.setAttribute('data-tooltip', lang === 'en' ? 'Back to Top' : '回到顶部');
        document.querySelectorAll('[data-ph-zh]').forEach(input => {
            input.setAttribute('placeholder', lang === 'en' ? (input.dataset.phEn || input.dataset.phZh) : input.dataset.phZh);
        });
    }

    // ==================== 6. 滑动提示浮窗 ====================
    function initSlideHint() {
        const pagePath = window.location.pathname;
        const storageKey = `lelele_read_slide_hint_${pagePath}`;
        const lastShowTime = JSON.parse(localStorage.getItem(storageKey) || '0');
        const now = Date.now();
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

        if (now - lastShowTime < THIRTY_DAYS) return;
        if (document.documentElement.scrollHeight <= window.innerHeight + 200) return;

        const hint = document.createElement('div');
        hint.className = 'common-slide-hint';
        hint.innerHTML = `
            <span class="zh-inline">👇 向下滑动可以查看更多</span>
            <span class="en-inline">👇 Scroll down to see more</span>
            <button id="slideHintBtn">
                <span class="zh-inline">知道了</span>
                <span class="en-inline">Got it</span>
            </button>
        `;
        document.body.appendChild(hint);

        setTimeout(() => hint.classList.add('show'), 100);
        let closeTimer = setTimeout(closeHint, 15000);

        function closeHint() {
            clearTimeout(closeTimer);
            hint.classList.remove('show');
            try { localStorage.setItem(storageKey, JSON.stringify(now)); } catch(e){}
            setTimeout(() => hint.remove(), 400);
        }
        document.getElementById('slideHintBtn').onclick = closeHint;
    }

    // ==================== 7. PWA 注册 ====================
    function initPWA() {
        if ('serviceWorker' in navigator && window.location.hostname === 'read.leleleling.site') {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
        }
    }

    // ==================== 8. 初始化执行 ====================
    initLang();
    initTheme();
    initManifest();

    document.addEventListener('DOMContentLoaded', () => {
        injectFooter();
        injectFloatTools();
        fetchAuthors();
        initPWA();
        initSlideHint();
        
        // 初始加载同步一次状态
        const currentLang = getLang();
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.langBtn === currentLang);
        });
    });

})();