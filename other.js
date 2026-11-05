/* =========================================================
   other.js - 杂项公共交互：统一空态 / 加载态 / 确认对话框
   ========================================================= */
window.ReadUI = (function () {
    'use strict';

    function t(zh, en) { return (window.getLang && window.getLang() === 'en') ? en : zh; }
    function esc(s) { return window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s); }

    function setState(container, kind, msg) {
        if (!container) return;
        const cls = kind === 'error' ? 'read-error' : (kind === 'loading' ? 'read-loading' : 'read-empty');
        container.innerHTML = `<div class="${cls}">${esc(msg || '')}</div>`;
    }
    function empty(container, msg) { setState(container, 'empty', msg || t('暂无内容', 'Nothing here yet')); }
    function loading(container, msg) { setState(container, 'loading', msg || t('正在加载…', 'Loading…')); }
    function error(container, msg) { setState(container, 'error', msg || t('加载失败，请稍后再试', 'Failed to load, please try again')); }

    function confirm(message, onOk) {
        let mask = document.getElementById('readConfirmMask');
        if (!mask) {
            mask = document.createElement('div');
            mask.id = 'readConfirmMask';
            mask.className = 'read-modal-mask';
            mask.innerHTML = `<div class="read-modal" role="dialog" aria-modal="true">
                <h3 id="readConfirmTitle"></h3>
                <p id="readConfirmText"></p>
                <div class="actions">
                    <button class="rd-btn" id="readConfirmCancel"></button>
                    <button class="rd-btn primary" id="readConfirmOk"></button>
                </div>
            </div>`;
            document.body.appendChild(mask);
            mask.addEventListener('click', e => { if (e.target === mask) close(); });
        }
        function close() { mask.classList.remove('open'); }
        document.getElementById('readConfirmTitle').textContent = t('请确认', 'Please confirm');
        document.getElementById('readConfirmText').textContent = message;
        const cancel = document.getElementById('readConfirmCancel');
        const okBtn = document.getElementById('readConfirmOk');
        cancel.textContent = t('取消', 'Cancel');
        okBtn.textContent = t('确定', 'Confirm');
        cancel.onclick = close;
        okBtn.onclick = () => { close(); if (typeof onOk === 'function') onOk(); };
        mask.classList.add('open');
    }

    function showMsg(el, text, isOk) {
        if (!el) return;
        el.textContent = text || '';
        el.className = 'read-msg ' + (isOk ? 'ok' : 'err');
    }

    return { empty, loading, error, confirm, showMsg, t };
})();
