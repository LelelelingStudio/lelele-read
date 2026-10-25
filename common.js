/* =========================================
   common.js - 全站公共逻辑与基建 (优化版)
   ========================================= */

(function() {
    'use strict';

    // ==================== 1. 全局配置项 ====================
    const CONFIG = {
        SITE_URL: 'https://read.leleleling.site',
        AUTHOR_API: 'https://authors.surge.sh/lelelereadauthor.json',
        FEEDBACK_URL: 'mailto:leleleling@2980.com',
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
        void toast.offsetWidth; // 触发重绘
        toast.classList.add('show');
        
        if (window.toastTimer) clearTimeout(window.toastTimer);
        window.toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    };

    // 封装统一的埋点函数
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
        
        // 重新渲染依赖语言的部分
        injectFooter();
        updateFloatToolsLang();
        initManifest(); 
        
        // 广播事件，让各页面自行监听更新
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

    // 动态加载 PWA Manifest
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
    function fetchAuthors() {
        window.AUTHORS_DATA = []; 
        fetch(CONFIG.AUTHOR_API + '?t=' + Date.now())
            .then(res => res.json())
            .then(data => {
                window.AUTHORS_DATA = data;
                window.dispatchEvent(new Event('authorsLoaded'));
            })
            .catch(err => {
                console.warn('获取外部作者列表失败:', err);
            });
    }

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
        
        // 反馈按钮默认显示
        btnFeedback.classList.add('show');

        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) btnTop.classList.add('show');
            else btnTop.classList.remove('show');
        });
        
        btnTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
        btnFeedback.onclick = () => window.open(CONFIG.FEEDBACK_URL, '_blank');

        updateFloatToolsLang();
    }

    function updateFloatToolsLang() {
        const lang = getLang();
        const fbBtn = document.getElementById('commonBtnFeedback');
        const topBtn = document.getElementById('commonBtnTop');
        if (fbBtn) fbBtn.setAttribute('data-tooltip', lang === 'en' ? 'Feedback' : '意见反馈');
        if (topBtn) topBtn.setAttribute('data-tooltip', lang === 'en' ? 'Back to Top' : '回到顶部');
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
    initManifest(); // 初始加载一次 Manifest

    document.addEventListener('DOMContentLoaded', () => {
        injectFooter();
        injectFloatTools();
        fetchAuthors();
        initPWA();
        initSlideHint();
    });

})();