/* =========================================
   window.js - 全站通用弹窗控制逻辑
   ========================================= */

const LeleleWindow = (function() {
    'use strict';

    // 创建弹窗骨架并插入 DOM
    function createModal(id, title, contentHtml, footerHtml, isLargeSearch = false) {
        let overlay = document.getElementById(id);
        if (overlay) return overlay; // 如果已存在则直接返回

        overlay = document.createElement('div');
        overlay.id = id;
        overlay.className = 'lelele-modal-overlay';

        const boxClass = isLargeSearch ? 'lelele-modal-box lelele-search-modal' : 'lelele-modal-box';
        
        overlay.innerHTML = `
            <div class="${boxClass}">
                <div class="lelele-modal-header">
                    <div class="lelele-modal-title">${title}</div>
                    <button class="lelele-modal-close">&times;</button>
                </div>
                <div class="lelele-modal-body">${contentHtml}</div>
                ${footerHtml ? `<div class="lelele-modal-footer">${footerHtml}</div>` : ''}
            </div>
        `;

        document.body.appendChild(overlay);

        // 绑定关闭事件
        const closeBtn = overlay.querySelector('.lelele-modal-close');
        closeBtn.onclick = () => closeModal(id);
        
        // 点击遮罩层关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(id);
        });

        return overlay;
    }

    // 打开弹窗
    function openModal(id) {
        const overlay = document.getElementById(id);
        if (overlay) {
            overlay.classList.add('active');
        }
    }

    // 关闭弹窗
    function closeModal(id) {
        const overlay = document.getElementById(id);
        if (overlay) {
            overlay.classList.remove('active');
        }
    }

    // ==================== 快捷调用工具 ====================

    // 1. 统一的二次确认框（替代原生 confirm）
    function showConfirm(title, message, onConfirm) {
        const id = 'leleleConfirmModal';
        let overlay = document.getElementById(id);
        if (overlay) overlay.remove(); // 每次重新创建以确保按钮事件更新

        const footerHtml = `
            <button class="lelele-btn lelele-btn-secondary" id="leleleConfirmCancel">取消</button>
            <button class="lelele-btn lelele-btn-primary" id="leleleConfirmOk">确定</button>
        `;
        overlay = createModal(id, title, `<p>${message}</p>`, footerHtml);
        
        overlay.querySelector('#leleleConfirmCancel').onclick = () => closeModal(id);
        overlay.querySelector('#leleleConfirmOk').onclick = () => {
            closeModal(id);
            if (typeof onConfirm === 'function') onConfirm();
        };
        
        openModal(id);
    }

    // 2. 统一的提示框（替代原生 alert）
    function showAlert(title, message) {
        const id = 'leleleAlertModal';
        let overlay = document.getElementById(id);
        if (overlay) overlay.remove();

        const footerHtml = `<button class="lelele-btn lelele-btn-primary" id="leleleAlertOk">知道了</button>`;
        overlay = createModal(id, title, `<p>${message}</p>`, footerHtml);
        
        overlay.querySelector('#leleleAlertOk').onclick = () => closeModal(id);
        
        openModal(id);
    }

    // 3. 统一的输入框（替代原生 prompt）
    function showPrompt(title, defaultValue, onSave) {
        const id = 'lelelePromptModal';
        let overlay = document.getElementById(id);
        if (overlay) overlay.remove();

        const contentHtml = `
            <input type="text" id="lelelePromptInput" value="${window.escapeHtml(defaultValue || '')}" 
                   style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-page); color:var(--text-main); outline:none;">
        `;
        const footerHtml = `
            <button class="lelele-btn lelele-btn-secondary" id="lelelePromptCancel">取消</button>
            <button class="lelele-btn lelele-btn-primary" id="lelelePromptOk">保存</button>
        `;
        overlay = createModal(id, title, contentHtml, footerHtml);
        
        const input = overlay.querySelector('#lelelePromptInput');
        setTimeout(() => input.focus(), 100); // 自动聚焦

        overlay.querySelector('#lelelePromptCancel').onclick = () => closeModal(id);
        overlay.querySelector('#lelelePromptOk').onclick = () => {
            const val = input.value;
            closeModal(id);
            if (typeof onSave === 'function') onSave(val);
        };
        
        openModal(id);
    }

    return {
        open: openModal,
        close: closeModal,
        confirm: showConfirm,
        alert: showAlert,
        prompt: showPrompt
    };
})();

// 挂载到 window 方便全站直接调用
window.LeleleWindow = LeleleWindow;