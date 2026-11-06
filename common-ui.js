/* ============================================================
   common-ui.js — 了了了读 · 公共底座
   依赖：common.js（getLang / escapeHtml / showToast / setLang）
   加载顺序：common.js 之后、各页业务脚本之前（同步 script）
   对外：window.Lelele = { Store, Bus, UI, t, esc, PREFIX, VERSION }
   ============================================================ */
(function () {
    'use strict';

    var PREFIX = 'lelele_read_';
    var VERSION = '3.0.0';
    var doc = document, win = window;

    function lang() { return doc.documentElement.getAttribute('data-lang') || 'zh'; }
    function t(zh, en) { return lang() === 'en' ? en : zh; }
    var esc = win.escapeHtml || function (s) {
        return s === null || s === undefined ? '' : String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    function toast(msg) { if (win.showToast) win.showToast(msg); else console.log('[Lelele]', msg); }
    function warn(mod, e) { console.warn('[Lelele:' + mod + ']', (e && e.message) || e); }
    function pad2(n) { return n < 10 ? '0' + n : '' + n; }
    function dayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function full(k) { return k.indexOf(PREFIX) === 0 ? k : PREFIX + k; }
    function short(k) { return k.indexOf(PREFIX) === 0 ? k.slice(PREFIX.length) : k; }

    /* ---------------- Bus：事件总线 ---------------- */
    var handlers = Object.create(null);
    var Bus = {
        on: function (name, fn) {
            if (!handlers[name]) handlers[name] = [];
            handlers[name].push(fn);
            return function () { Bus.off(name, fn); };
        },
        off: function (name, fn) {
            if (!handlers[name]) return;
            handlers[name] = handlers[name].filter(function (f) { return f !== fn; });
        },
        emit: function (name, payload) {
            (handlers[name] || []).slice().forEach(function (fn) {
                try { fn(payload); } catch (e) { warn('Bus:' + name, e); }
            });
        }
    };

    /* ---------------- Store：统一存储门面 ----------------
       get 对历史裸字符串键（lang/theme/fontSize…）自动兼容；
       set 写 string 时保持裸字符串，其余 JSON.stringify，与既有格式一致。
    ----------------------------------------------------- */
    var writeMarks = Object.create(null);
    function mark(k, v) { writeMarks[k] = { v: v, at: Date.now() }; }

    var Store = {
        PREFIX: PREFIX,
        raw: function (k) { try { return localStorage.getItem(full(k)); } catch (e) { return null; } },
        get: function (k, fb) {
            try {
                var v = localStorage.getItem(full(k));
                if (v === null || v === undefined) return fb;
                try { return JSON.parse(v); } catch (e) { return v; }
            } catch (e) { return fb; }
        },
        set: function (k, v) {
            try {
                var s = (typeof v === 'string') ? v : JSON.stringify(v);
                localStorage.setItem(full(k), s);
                mark(full(k), s);
                return true;
            } catch (e) {
                warn('Store.set', e);
                toast(t('本地存储空间不足，部分数据未保存', 'Local storage is full; some data was not saved'));
                return false;
            }
        },
        remove: function (k) { try { localStorage.removeItem(full(k)); return true; } catch (e) { return false; } },
        keys: function () {
            var out = [];
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf(PREFIX) === 0) out.push(short(k));
                }
            } catch (e) { warn('Store.keys', e); }
            return out;
        },
        /* 按天聚合：数值字段累加，其余覆盖；保留最近 400 天 */
        daily: function () {
            var d = Store.get('daily', {});
            return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
        },
        mergeDaily: function (day, patch) {
            var d = Store.daily(), rec = d[day] || {};
            Object.keys(patch || {}).forEach(function (k) {
                var v = patch[k];
                if (typeof v === 'number') rec[k] = (Number(rec[k]) || 0) + v;
                else rec[k] = v;
            });
            d[day] = rec;
            var days = Object.keys(d).sort();
            while (days.length > 400) delete d[days.shift()];
            Store.set('daily', d);
            Bus.emit('daily', { day: day, record: rec });
            return rec;
        },
        /* 备份：跳过会话/档案/OTP，避免把登录态带给别人 */
        exportAll: function () {
            var data = {};
            Store.keys().forEach(function (k) {
                if (k === 'api_session' || k.indexOf('api_profile_') === 0 || k.indexOf('otp_') === 0) return;
                data[k] = Store.raw(k);
            });
            return { app: 'lelele-read', version: VERSION, exportedAt: new Date().toISOString(), data: data };
        },
        importAll: function (backup, mode) {
            var report = { ok: false, added: 0, updated: 0, removed: 0, skipped: 0, errors: [] };
            if (!backup || !backup.data || typeof backup.data !== 'object') {
                report.errors.push(t('备份文件格式不正确', 'Invalid backup file format'));
                return report;
            }
            var incoming = backup.data;
            try {
                if (mode === 'replace') {
                    Store.keys().forEach(function (k) {
                        if (k === 'api_session' || k.indexOf('api_profile_') === 0) return;
                        Store.remove(k); report.removed++;
                    });
                }
                Object.keys(incoming).forEach(function (k) {
                    if (k === 'api_session' || k.indexOf('api_profile_') === 0 || k.indexOf('otp_') === 0) {
                        report.skipped++; return;
                    }
                    var had = Store.raw(k) !== null;
                    try {
                        var s = String(incoming[k]);
                        localStorage.setItem(full(k), s);
                        mark(full(k), s);
                        had ? report.updated++ : report.added++;
                    } catch (e) { report.errors.push(k); }
                });
                report.ok = report.errors.length === 0;
            } catch (e) { warn('Store.importAll', e); report.errors.push(String(e.message || e)); }
            return report;
        },
        usage: function () {
            var bytes = 0;
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf(PREFIX) === 0) bytes += (k.length + (localStorage.getItem(k) || '').length) * 2;
                }
            } catch (e) { warn('Store.usage', e); }
            return { used: bytes, quota: 5 * 1024 * 1024 };
        }
    };

    win.addEventListener('langChanged', function () { Bus.emit('lang', lang()); });
    win.addEventListener('themeChanged', function () {
        Bus.emit('theme', doc.documentElement.classList.contains('dark-mode') ? 'dark' : 'light');
    });
    win.addEventListener('storage', function (e) {
        if (!e.key || e.key.indexOf(PREFIX) !== 0) return;
        var m = writeMarks[e.key];
        var self = !!(m && m.v === e.newValue && Date.now() - m.at < 2000);
        var payload = { key: short(e.key), fullKey: e.key, oldValue: e.oldValue, newValue: e.newValue, self: self };
        Bus.emit('storage', payload);
        Bus.emit('storage:' + short(e.key), payload);
    });

    /* ---------------- UI：全局组件 ---------------- */
    var commands = [];
    var undoStack = [];
    var isSubPage = location.pathname.indexOf('/data/community/') >= 0;
    var BASE = isSubPage ? '../../' : '';

    function el(id) { return doc.getElementById(id); }
    function make(tag, cls, html) {
        var n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (html !== undefined) n.innerHTML = html;
        return n;
    }
    function closeLayer(node) { if (node) node.hidden = true; }

    function usageText() {
        var u = Store.usage();
        return t('本地已用 ', 'Local storage ') + (u.used / 1024).toFixed(1) + ' KB / ' + (u.quota / 1024 / 1024).toFixed(0) + ' MB';
    }

    /* 命令面板 */
    var cmdLayer = null, cmdInput = null, cmdList = null, cmdActive = 0, cmdShown = [];
    function ensureCmd() {
        if (cmdLayer) return;
        cmdLayer = make('div', 'll-overlay');
        cmdLayer.id = 'leleleCmd';
        cmdLayer.hidden = true;
        var box = make('div', 'll-cmd');
        cmdInput = make('input', 'll-cmd-input');
        cmdInput.type = 'text';
        cmdInput.id = 'leleleCmdInput';
        cmdInput.setAttribute('autocomplete', 'off');
        cmdList = make('div', 'll-cmd-list');
        var foot = make('div', 'll-cmd-foot');
        foot.id = 'leleleCmdFoot';
        box.appendChild(cmdInput); box.appendChild(cmdList); box.appendChild(foot);
        cmdLayer.appendChild(box);
        doc.body.appendChild(cmdLayer);

        cmdInput.addEventListener('input', renderCmd);
        cmdInput.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') { e.preventDefault(); moveCmd(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); moveCmd(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdActive); }
            else if (e.key === 'Escape') { e.preventDefault(); UI.closeCommand(); }
        });
        cmdLayer.addEventListener('click', function (e) { if (e.target === cmdLayer) UI.closeCommand(); });
    }
    function cmdTitle(c) { return lang() === 'en' ? (c.en || c.zh || c.id) : (c.zh || c.en || c.id); }
    function renderCmd() {
        if (!cmdList) return;
        var q = (cmdInput.value || '').trim().toLowerCase();
        cmdShown = commands.filter(function (c) {
            if (!q) return true;
            return (cmdTitle(c) + ' ' + (c.en || '') + ' ' + (c.zh || '') + ' ' + (c.keywords || '')).toLowerCase().indexOf(q) >= 0;
        });
        cmdActive = 0;
        cmdList.innerHTML = cmdShown.length ? cmdShown.map(function (c, i) {
            return '<button type="button" class="ll-cmd-item' + (i === 0 ? ' active' : '') + '" data-i="' + i + '">' +
                '<span class="ll-cmd-icon">' + esc(c.icon || '›') + '</span>' +
                '<span class="ll-cmd-label">' + esc(cmdTitle(c)) + '</span>' +
                (c.section ? '<span class="ll-cmd-sec">' + esc(c.section) + '</span>' : '') + '</button>';
        }).join('') : '<div class="ll-empty">' + esc(t('没有匹配的功能', 'No matching command')) + '</div>';
        Array.prototype.forEach.call(cmdList.querySelectorAll('.ll-cmd-item'), function (b) {
            b.addEventListener('click', function () { runCmd(parseInt(b.dataset.i, 10)); });
        });
        var foot = el('leleleCmdFoot');
        if (foot) foot.textContent = usageText() + ' · ↑↓ ' + t('选择', 'select') + ' · Enter ' + t('执行', 'run') + ' · Esc ' + t('关闭', 'close');
    }
    function moveCmd(d) {
        if (!cmdShown.length) return;
        cmdActive = (cmdActive + d + cmdShown.length) % cmdShown.length;
        Array.prototype.forEach.call(cmdList.querySelectorAll('.ll-cmd-item'), function (b, i) {
            b.classList.toggle('active', i === cmdActive);
            if (i === cmdActive && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' });
        });
    }
    function runCmd(i) {
        var c = cmdShown[i];
        if (!c) return;
        UI.closeCommand();
        try { c.run(); } catch (e) { warn('command:' + c.id, e); toast(t('执行失败', 'Command failed')); }
    }

    /* 通用面板（帮助 / 备份） */
    function openPanel(id, title, bodyHtml, after) {
        var layer = el(id);
        if (!layer) {
            layer = make('div', 'll-overlay');
            layer.id = id;
            doc.body.appendChild(layer);
            layer.addEventListener('click', function (e) { if (e.target === layer) layer.hidden = true; });
        }
        layer.innerHTML = '<div class="ll-panel"><div class="ll-panel-head"><h3>' + esc(title) + '</h3>' +
            '<button type="button" class="ll-x" aria-label="Close">×</button></div>' +
            '<div class="ll-panel-body">' + bodyHtml + '</div></div>';
        layer.hidden = false;
        layer.querySelector('.ll-x').addEventListener('click', function () { layer.hidden = true; });
        if (after) after(layer);
        return layer;
    }

    var SHORTCUTS = [
        ['Ctrl / ⌘ + K', '打开命令面板', 'Open command palette'],
        ['?', '快捷键帮助', 'Keyboard shortcuts'],
        ['Ctrl / ⌘ + Z', '撤销上一步操作', 'Undo last action'],
        ['Esc', '关闭弹层', 'Close any overlay'],
        ['← / →', '阅读器上一章 / 下一章', 'Reader: previous / next chapter'],
        ['Ctrl / ⌘ + P', '写作台预览切换', 'Writing desk: toggle preview'],
        ['Ctrl / ⌘ + S', '写作台下载 JSON', 'Writing desk: download JSON'],
        ['Ctrl / ⌘ + F', '全文 / 书内搜索', 'Find in book or page'],
        ['Ctrl / ⌘ + /', '写作台斜杠命令', 'Writing desk: slash commands']
    ];

    var UI = {
        VERSION: VERSION,
        t: t, esc: esc, toast: toast, warn: warn, dayKey: dayKey, base: BASE,
        Store: Store, Bus: Bus,
        registerCommand: function (c) { if (c && c.id && typeof c.run === 'function') commands.push(c); },
        usageText: usageText,

        openCommand: function () {
            ensureCmd();
            cmdLayer.hidden = false;
            cmdInput.value = '';
            renderCmd();
            setTimeout(function () { cmdInput.focus(); }, 0);
        },
        closeCommand: function () { closeLayer(cmdLayer); },
        openHelp: function () {
            var rows = SHORTCUTS.map(function (s) {
                return '<tr><td><kbd>' + esc(s[0]) + '</kbd></td><td>' + esc(lang() === 'en' ? s[2] : s[1]) + '</td></tr>';
            }).join('');
            openPanel('leleleHelp', t('快捷键', 'Keyboard shortcuts'), '<table class="ll-table">' + rows + '</table>');
        },
        openBackup: function () {
            var u = Store.usage();
            var html = '<p class="ll-note">' + esc(t('所有阅读进度、笔记、草稿与设置只存在这台设备的浏览器里。换设备或清理浏览器数据前，请先导出备份。', 'Reading progress, notes, drafts and settings live only in this browser. Export a backup before switching devices or clearing browser data.')) + '</p>' +
                '<div class="ll-meter"><span style="width:' + Math.min(100, u.used / u.quota * 100).toFixed(1) + '%"></span></div>' +
                '<p class="ll-usage">' + esc(usageText()) + '</p>' +
                '<div class="ll-row"><button type="button" class="rd-btn primary" id="llExport">' + esc(t('导出备份', 'Export backup')) + '</button>' +
                '<button type="button" class="rd-btn" id="llImport">' + esc(t('导入备份', 'Import backup')) + '</button>' +
                '<input type="file" id="llImportFile" accept="application/json,.json" hidden></div>' +
                '<div class="ll-row"><label class="ll-check"><input type="radio" name="llMode" value="merge" checked> ' + esc(t('合并（保留现有数据）', 'Merge (keep existing)')) + '</label>' +
                '<label class="ll-check"><input type="radio" name="llMode" value="replace"> ' + esc(t('替换（先清空）', 'Replace (clear first)')) + '</label></div>' +
                '<div id="llBackupMsg" class="ll-msg"></div>' +
                '<hr><button type="button" class="rd-btn ll-danger" id="llClear">' + esc(t('清空本站本地数据', 'Clear all local data')) + '</button>';
            openPanel('leleleBackup', t('数据备份与迁移', 'Data backup & migration'), html, function (layer) {
                var msg = layer.querySelector('#llBackupMsg');
                layer.querySelector('#llExport').addEventListener('click', function () {
                    try {
                        var blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: 'application/json' });
                        var a = doc.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = 'lelele-read-backup-' + dayKey() + '.json';
                        a.click();
                        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
                        msg.textContent = t('备份已下载', 'Backup downloaded');
                    } catch (e) { warn('export', e); msg.textContent = t('导出失败', 'Export failed'); }
                });
                var file = layer.querySelector('#llImportFile');
                layer.querySelector('#llImport').addEventListener('click', function () { file.click(); });
                file.addEventListener('change', function () {
                    var f = file.files && file.files[0];
                    if (!f) return;
                    var reader = new FileReader();
                    reader.onload = function () {
                        try {
                            var mode = (layer.querySelector('input[name="llMode"]:checked') || {}).value || 'merge';
                            var rep = Store.importAll(JSON.parse(reader.result), mode);
                            msg.textContent = rep.ok
                                ? t('导入成功：新增 ', 'Imported: added ') + rep.added + t('，更新 ', ', updated ') + rep.updated + t('，跳过 ', ', skipped ') + rep.skipped + t('。刷新页面后生效。', '. Reload to apply.')
                                : t('导入出现问题', 'Import had errors');
                            Bus.emit('backupImported', rep);
                        } catch (e) { warn('import', e); msg.textContent = t('文件解析失败', 'Could not parse file'); }
                    };
                    reader.readAsText(f);
                });
                layer.querySelector('#llClear').addEventListener('click', function () {
                    var ok = win.confirm(t('确定清空本站在这台设备上的全部本地数据？此操作不可撤销，建议先导出备份。', 'Clear all local data on this device? This cannot be undone; export a backup first.'));
                    if (!ok) return;
                    Store.keys().forEach(function (k) { Store.remove(k); });
                    msg.textContent = t('已清空，即将刷新页面', 'Cleared; reloading…');
                    setTimeout(function () { location.reload(); }, 800);
                });
            });
        },

        pushUndo: function (label, fn) {
            undoStack.push({ label: label, fn: fn });
            if (undoStack.length > 30) undoStack.shift();
        },
        undo: function () {
            var u = undoStack.pop();
            if (!u) { toast(t('没有可撤销的操作', 'Nothing to undo')); return false; }
            try { u.fn(); toast(t('已撤销：', 'Undone: ') + u.label); Bus.emit('undo', u.label); return true; }
            catch (e) { warn('undo', e); return false; }
        },
        showUndo: function (msg, fn, label) {
            UI.pushUndo(label || msg, fn);
            var bar = el('leleleUndo');
            if (!bar) {
                bar = make('div', 'll-undo'); bar.id = 'leleleUndo';
                doc.body.appendChild(bar);
                bar.addEventListener('click', function (e) {
                    if (e.target.dataset.act === 'undo') { UI.undo(); bar.hidden = true; }
                });
            }
            bar.innerHTML = '<span>' + esc(msg) + '</span><button type="button" data-act="undo">' + esc(t('撤销', 'Undo')) + '</button>';
            bar.hidden = false;
            clearTimeout(bar._timer);
            bar._timer = setTimeout(function () { bar.hidden = true; }, 8000);
        }
    };

    /* 暗色跟随系统 */
    function initSystemTheme() {
        if (!win.matchMedia) return;
        var mq = win.matchMedia('(prefers-color-scheme: dark)');
        var follow = Store.get('theme_follow_system', false) === true;
        function apply() {
            if (!follow) return;
            doc.documentElement.classList.toggle('dark-mode', mq.matches);
            Bus.emit('theme', mq.matches ? 'dark' : 'light');
        }
        if (mq.addEventListener) mq.addEventListener('change', apply);
        else if (mq.addListener) mq.addListener(apply);
        apply();
        Bus.on('themeFollow', function (v) {
            follow = !!v;
            Store.set('theme_follow_system', follow);
            if (follow) Store.remove('theme');
            apply();
        });
    }

    /* 减少动画 & 焦点可见 */
    function initA11y() {
        if (!win.matchMedia) return;
        var mq = win.matchMedia('(prefers-reduced-motion: reduce)');
        function sync() { doc.documentElement.classList.toggle('ll-reduced-motion', mq.matches); }
        if (mq.addEventListener) mq.addEventListener('change', sync);
        else if (mq.addListener) mq.addListener(sync);
        sync();
        doc.addEventListener('keydown', function (e) {
            if (e.key === 'Tab') doc.documentElement.classList.add('ll-keyboard');
        });
        doc.addEventListener('mousedown', function () { doc.documentElement.classList.remove('ll-keyboard'); });
    }

    /* 懒加载 */
    function initLazy() {
        try {
            Array.prototype.forEach.call(doc.querySelectorAll('img:not([loading])'), function (img) { img.loading = 'lazy'; });
            if ('IntersectionObserver' in win) {
                var io = new IntersectionObserver(function (entries) {
                    entries.forEach(function (en) {
                        if (!en.isIntersecting) return;
                        en.target.dispatchEvent(new CustomEvent('lelele:visible'));
                        io.unobserve(en.target);
                    });
                }, { rootMargin: '200px' });
                Array.prototype.forEach.call(doc.querySelectorAll('[data-lazy]'), function (n) { io.observe(n); });
            }
        } catch (e) { warn('lazy', e); }
    }

    /* 反馈：统一内嵌弹窗（不依赖 Tally SDK），另附正确地址的新页面入口 */
    var FEEDBACK_PAGE = 'https://tally.so/r/pedeGV';
    function openFeedback() {
        var lay = el('leleleFeedbackModal');
        if (!lay) {
            lay = make('div', 'll-overlay ll-feedback-modal');
            lay.id = 'leleleFeedbackModal';
            lay.innerHTML = '<div class="ll-panel ll-feedback-panel">' +
                '<div class="ll-panel-head"><h3>' + t('意见反馈 · Feedback', 'Feedback') + '</h3>' +
                '<button type="button" class="ll-x" data-fb-close aria-label="Close">×</button></div>' +
                '<div class="ll-panel-body">' +
                '<iframe src="https://tally.so/embed/pedeGV?transparentBackground=1&dynamicHeight=1" ' +
                'title="Feedback" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>' +
                '<div class="ll-row"><a class="rd-btn" href="' + FEEDBACK_PAGE + '" target="_blank" rel="noopener">' +
                t('在新页面打开', 'Open in a new tab') + '</a></div></div></div>';
            doc.body.appendChild(lay);
            lay.addEventListener('click', function (e) {
                if (e.target === lay || (e.target.closest && e.target.closest('[data-fb-close]'))) lay.hidden = true;
            });
        }
        lay.hidden = false;
    }
    win.leleleOpenFeedback = openFeedback;

    /* 全站只保留一个反馈入口：common.js 的 💬 优先，其余页面才补一个 */
    function initFeedback() {
        if (el('commonBtnFeedback') || el('readerApp')) return;
        if (Store.get('hide_feedback', false) === true) return;
        var b = make('button', 'll-feedback');
        b.type = 'button';
        b.title = t('意见反馈', 'Feedback');
        b.setAttribute('aria-label', t('意见反馈', 'Feedback'));
        b.innerHTML = '<span class="zh-inline">反馈</span><span class="en-inline">Feedback</span>';
        b.addEventListener('click', openFeedback);
        doc.body.appendChild(b);
    }

    /* 内置命令 */
    function registerBuiltins() {
        [
            { id: 'lang', zh: '切换中 / EN', en: 'Switch language', icon: '文', keywords: 'language 语言', run: function () { if (win.setLang) win.setLang(lang() === 'zh' ? 'en' : 'zh'); } },
            { id: 'theme', zh: '切换深色 / 浅色', en: 'Toggle dark mode', icon: '◐', keywords: 'theme dark 主题', run: function () { if (win.toggleTheme) win.toggleTheme(); } },
            { id: 'themeFollow', zh: '深色模式跟随系统', en: 'Follow system dark mode', icon: '◑', keywords: 'system theme', run: function () {
                var on = Store.get('theme_follow_system', false) !== true;
                Bus.emit('themeFollow', on);
                toast(on ? t('已跟随系统', 'Following system') : t('已取消跟随', 'Manual theme'));
            } },
            { id: 'help', zh: '快捷键帮助', en: 'Keyboard shortcuts', icon: '?', keywords: 'shortcut key', run: function () { UI.openHelp(); } },
            { id: 'backup', zh: '数据备份与迁移', en: 'Backup & restore', icon: '⇩', keywords: 'export import 备份', run: function () { UI.openBackup(); } },
            { id: 'home', zh: '回到首页', en: 'Go to home', icon: '⌂', keywords: 'home index', run: function () { location.href = BASE + 'index.html'; } },
            { id: 'reader', zh: '打开阅读器', en: 'Open reader', icon: '▤', keywords: 'read book', run: function () { location.href = BASE + 'reader.html'; } },
            { id: 'bible', zh: '打开圣经阅读器', en: 'Open Bible reader', icon: '✞', keywords: 'bible 圣经 holy', run: function () { location.href = BASE + 'bible.html'; } },
            { id: 'bible-search', zh: '搜索圣经经文', en: 'Search Bible verses', icon: '⌕', keywords: 'bible verse search 经文 搜索', run: function () { if (win.LeleleBibleTools) win.LeleleBibleTools.openSearch(); else location.href = BASE + 'bible.html?act=search'; } },
            { id: 'draft', zh: '打开写作台', en: 'Open writing desk', icon: '✍', keywords: 'write draft', run: function () { location.href = BASE + 'draft.html'; } },
            { id: 'community', zh: '共创书库', en: 'Community library', icon: '❖', keywords: 'community', run: function () { location.href = (isSubPage ? './' : 'data/community/') + 'index.html'; } },
            { id: 'dashboard', zh: '作者面板', en: 'Author dashboard', icon: '◈', keywords: 'author dashboard', run: function () { location.href = BASE + 'dashboard.html'; } },
            { id: 'about', zh: '关于与更新日志', en: 'About & changelog', icon: 'ⓘ', keywords: 'version changelog', run: function () { location.href = BASE + 'about.html'; } },
            { id: 'feedback', zh: '意见反馈', en: 'Send feedback', icon: '✉', keywords: 'tally feedback', run: function () { openFeedback(); } }
        ].forEach(UI.registerCommand);
    }

    /* 全局键盘 */
    function initKeys() {
        doc.addEventListener('keydown', function (e) {
            var tag = ((e.target && e.target.tagName) || '').toLowerCase();
            var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
            var mod = e.ctrlKey || e.metaKey;
            var key = (e.key || '').toLowerCase();
            if (mod && key === 'k') { e.preventDefault(); if (cmdLayer && !cmdLayer.hidden) UI.closeCommand(); else UI.openCommand(); return; }
            if (mod && key === 'z' && !typing) { e.preventDefault(); UI.undo(); return; }
            if (e.key === '?' && !typing && !mod && !e.altKey) { e.preventDefault(); UI.openHelp(); return; }
            if (e.key === 'Escape') {
                closeLayer(cmdLayer);
                ['leleleHelp', 'leleleBackup', 'leleleFeedbackModal'].forEach(function (id) { var n = el(id); if (n) n.hidden = true; });
            }
        });
    }

    /* 第三方统计：与「了了了游」boot.js 同款做法（仅 data-domain 不同）。
       必须 DOM 就绪后动态注入，不能写成 <head> 里的 defer 外链：
       外部脚本一旦挂起，defer 会拖住 DOMContentLoaded 导致全站白屏。
       game.leleleling.site → read.leleleling.site；失败静默，不影响任何功能。 */
    function initAnalytics() {
        win.setTimeout(function () {
            try {
                var s = doc.createElement('script');
                s.src = 'https://analytics.leleleling.site/em.js';
                s.defer = true;
                s.async = true;
                s.setAttribute('data-domain', 'read.leleleling.site');
                s.onerror = function () { };
                doc.head.appendChild(s);
            } catch (e) { warn('analytics', e); }
        }, 0);
    }

    /* 冬季特效与公告：统一在这里注入，避免 14 个页面逐个加标签；
       data/community/ 子页需要回到站点根目录。加载失败静默，不影响主流程。 */
    function injectSiteAssets() {
        var base = /\/data\/community\//.test(location.pathname) ? '../../' : '';
        ['winter.css', 'notice.css'].forEach(function (f) {
            if (doc.querySelector('link[href$="' + f + '"]')) return;   /* 页面已静态引入则跳过 */
            var link = doc.createElement('link');
            link.rel = 'stylesheet';
            link.href = base + f;
            doc.head.appendChild(link);
        });
        ['winter.js', 'notice.js'].forEach(function (f) {
            if (doc.querySelector('script[src$="' + f + '"]')) return;
            var s = doc.createElement('script');
            s.src = base + f;
            s.async = false;
            s.onerror = function () { };
            doc.head.appendChild(s);
        });
        win.Lelele.assets = { base: base };
    }

    /* 初始化 */
    function init() {
        initSystemTheme();
        initA11y();
        initLazy();
        initFeedback();
        registerBuiltins();
        initKeys();
        initAnalytics();
        injectSiteAssets();
        Bus.emit('ready', { version: VERSION });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();

    win.Lelele = { Store: Store, Bus: Bus, UI: UI, t: t, esc: esc, PREFIX: PREFIX, VERSION: VERSION };
})();
