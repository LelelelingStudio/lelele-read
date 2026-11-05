/* =========================================================
   user-auth.js - 会话与登录态 UI 封装（独立于「游」站）
   只依赖 user-api.js / common.js，不含任何后端配置
   ========================================================= */
window.UserAuth = (function () {
    'use strict';

    function t(zh, en) { return (window.getLang && window.getLang() === 'en') ? en : zh; }
    function esc(s) { return window.escapeHtml ? window.escapeHtml(s || '') : String(s || ''); }
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
        const mail = esc(user.email || user.name || '');
        const initial = esc((mail.charAt(0) || '👤').toUpperCase());
        const account = t('账号', 'Account');
        slot.innerHTML = `<div class="auth-user">
            <button type="button" class="auth-avatar" id="authAvatar" aria-label="${account}" aria-expanded="false" title="${account}">👤</button>
            <a class="rd-btn primary auth-dash" href="dashboard.html">${t('作者后台', 'Dashboard')}</a>
            <div class="auth-menu" id="authMenu" hidden>
                <div class="auth-menu-head">
                    <span class="auth-initial">${initial}</span>
                    <span class="auth-mail" title="${mail}">${mail}</span>
                </div>
                <button type="button" class="rd-btn" id="btnSignOut">${t('退出', 'Sign out')}</button>
            </div>
        </div>`;
        const avatar = document.getElementById('authAvatar');
        const menu = document.getElementById('authMenu');
        if (avatar && menu) {
            const closeMenu = () => { menu.hidden = true; avatar.setAttribute('aria-expanded', 'false'); };
            avatar.onclick = (e) => {
                e.stopPropagation();
                menu.hidden = !menu.hidden;
                avatar.setAttribute('aria-expanded', String(!menu.hidden));
            };
            document.addEventListener('click', (e) => {
                if (!menu.hidden && !menu.contains(e.target) && e.target !== avatar) closeMenu();
            });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
        }
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
