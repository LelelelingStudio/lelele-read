/* =========================================================
   user-auth.js - 会话与登录态 UI 封装（独立于「游」站）
   只依赖 user-api.js / common.js，不含任何后端配置
   ========================================================= */
window.UserAuth = (function () {
    'use strict';

    function t(zh, en) { return (window.getLang && window.getLang() === 'en') ? en : zh; }
    function current() { return window.UserAPI.getSession().user; }

    function isLoggedIn() { return !!current(); }

    function requireLogin(redirect) {
        if (isLoggedIn()) return true;
        const back = encodeURIComponent(redirect || location.pathname + location.search);
        location.href = 'login.html?redirect=' + back;
        return false;
    }

    // 在 .auth-slot / #authSlot 容器里渲染账号状态
    function renderAuthSlot() {
        const slot = document.getElementById('authSlot') || document.querySelector('.auth-slot');
        if (!slot) return;
        const user = current();
        if (!user) {
            slot.innerHTML = `<a class="rd-btn primary" href="login.html">${t('登录 / 注册', 'Sign in / Sign up')}</a>`;
            return;
        }
        const name = window.escapeHtml ? window.escapeHtml(user.email || user.name || '') : (user.email || '');
        slot.innerHTML = `<span class="auth-email">${name}</span>
            <a class="rd-btn" href="dashboard.html">${t('作者后台', 'Dashboard')}</a>
            <button class="rd-btn" id="btnSignOut">${t('退出', 'Sign out')}</button>`;
        const btn = document.getElementById('btnSignOut');
        if (btn) btn.onclick = async () => {
            await window.UserAPI.signOut();
            location.href = 'index.html';
        };
    }

    // 处理 OAuth / 邮件确认回跳：把 hash 里的 access_token 交给 SDK 或清理掉
    function handleCallback() {
        if (!location.hash || location.hash.indexOf('access_token') === -1) return;
        if (window.UserAPI.config.BACKEND_MODE === 'supabase' && window.supabase) {
            try { window.supabase.auth.getSessionFromUrl({ storeSession: true }).catch(() => { }); } catch (e) { }
        }
        history.replaceState(null, '', location.pathname + location.search);
    }

    function init() {
        handleCallback();
        renderAuthSlot();
        window.UserAPI.onAuthChange(renderAuthSlot);
        window.addEventListener('langChanged', renderAuthSlot);
    }

    return { init, current, isLoggedIn, requireLogin, renderAuthSlot, handleCallback };
})();
