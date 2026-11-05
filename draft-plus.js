/* ============================================================
   draft-plus.js — 写作台增强
   多草稿 / 分卷 / 版本快照 / 回收站 / 大纲人物卡 / 自动取名 /
   查找替换 / 富文本 / 双符号补齐 / 自动滚屏 / 日更曲线 / 目标环 /
   专注模式 / 打字音效 / 导入 Markdown / 投稿预填 / 敏感词检查 /
   斜杠命令 / 撤销 / 自动保存状态
   依赖：common.js → common-ui.js → draft.html（window.DraftCore）
   ============================================================ */
(function () {
    'use strict';
    var C = null, L = null, Store = null, UI = null, Bus = null, t = null, esc = null;
    var doc = document;
    function el(id) { return doc.getElementById(id); }
    function node(tag, cls, html) {
        var n = doc.createElement(tag);
        if (cls) n.className = cls;
        if (html !== undefined) n.innerHTML = html;
        return n;
    }
    function warn(m, e) { console.warn('[DraftPlus:' + m + ']', (e && e.message) || e); }
    function toast(m) { if (UI) UI.toast(m); }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function now() { return Date.now(); }
    function day() { return UI.dayKey(); }
    function ak(k) { return 'dp_' + k + '_' + (C.getAuthorId() || 'anon'); }
    function arr(k) { var v = Store.get(ak(k), []); return Array.isArray(v) ? v : []; }
    function setArr(k, v) { Store.set(ak(k), v); }
    function todayWords() { var d = Store.daily()[day()]; return (d && d.words) || 0; }

    var dirty = false, lastWordTotal = 0, autoVersionAt = 0, soundOn = false, focusOn = false;
    var drawer = null, dock = null, saveStateEl = null, ringEl = null;

    /* ---------------- 通用抽屉 ---------------- */
    function ensureDrawer() {
        if (drawer) return drawer;
        drawer = node('div', 'dp-drawer'); drawer.id = 'dpDrawer';
        drawer.innerHTML = '<div class="dp-drawer-head"><b id="dpDrawerTitle"></b><button type="button" class="ll-x" id="dpDrawerClose">×</button></div><div class="dp-drawer-body" id="dpDrawerBody"></div>';
        doc.body.appendChild(drawer);
        el('dpDrawerClose').onclick = function () { drawer.classList.remove('open'); };
        return drawer;
    }
    function openDrawer(title, html, after) {
        ensureDrawer();
        el('dpDrawerTitle').textContent = title;
        el('dpDrawerBody').innerHTML = html;
        drawer.classList.add('open');
        if (after) after(el('dpDrawerBody'));
    }
    function closeDrawer() { if (drawer) drawer.classList.remove('open'); }

    /* ---------------- 数据 ---------------- */
    function currentDoc() { C.sync(); return clone(C.get()); }
    function library() { return arr('library'); }
    function currentId() { return Store.get(ak('current'), ''); }
    function persistCurrent() {
        var id = currentId(); if (!id) return;
        var l = library(), e = l.filter(function (x) { return x.id === id; })[0];
        if (!e) { l.unshift({ id: id, name: C.get().title_zh || t('未命名草稿', 'Untitled draft'), doc: currentDoc(), updatedAt: now() }); }
        else { e.doc = currentDoc(); e.name = C.get().title_zh || e.name; e.updatedAt = now(); }
        setArr('library', l.slice(0, 20));
    }
    function blankDoc() {
        return { title_zh: '', title_en: '', author: C.getAuthorId(), template: 'novel', chapters: [{ title: t('第 1 章', 'Chapter 1'), paragraphs: [] }], storyboard: { outline: '', characters: [], settings: '' } };
    }
    function ensureLibrary() {
        var l = library();
        if (!l.length) {
            l = [{ id: 'd0', name: C.get().title_zh || t('我的第一份草稿', 'My first draft'), doc: currentDoc(), updatedAt: now() }];
            setArr('library', l);
            Store.set(ak('current'), 'd0');
        } else if (!currentId()) {
            Store.set(ak('current'), l[0].id);
        }
    }

    /* ---------------- 41 多草稿管理 ---------------- */
    function showLibrary() {
        persistCurrent();
        var l = library(), cid = currentId();
        var html = '<p class="ll-note">' + esc(t('草稿按作者隔离，全部保存在这台设备。点「新建」开始一份新书，切换时当前内容会自动存档。', 'Drafts are stored per author on this device. Create a new one to start another book; switching auto-saves your work.')) + '</p>' +
            '<div class="ll-row"><button type="button" class="rd-btn primary" id="dpNew">＋ ' + esc(t('新建草稿', 'New draft')) + '</button>' +
            '<button type="button" class="rd-btn" id="dpExportBackup">' + esc(t('备份全部数据', 'Backup all data')) + '</button></div>' +
            '<div class="dp-list">' + l.map(function (e) {
                var words = (e.doc.chapters || []).reduce(function (n, c) { return n + ((c.paragraphs || []).join('').length); }, 0);
                return '<div class="dp-list-item' + (e.id === cid ? ' active' : '') + '" data-id="' + esc(e.id) + '">' +
                    '<div><b>' + esc(e.name || e.doc.title_zh || t('未命名', 'Untitled')) + '</b>' +
                    '<small>' + (e.doc.chapters || []).length + ' ' + esc(t('章', 'chapters')) + ' · ' + words + ' ' + esc(t('字', 'chars')) + ' · ' + new Date(e.updatedAt || now()).toLocaleDateString() + '</small></div>' +
                    '<div class="dp-item-actions"><button type="button" data-act="open">' + esc(t('打开', 'Open')) + '</button>' +
                    '<button type="button" data-act="rename">✎</button><button type="button" data-act="del">×</button></div></div>';
            }).join('') + '</div>';
        openDrawer(t('我的草稿', 'My drafts'), html, function (box) {
            el('dpNew').onclick = function () {
                persistCurrent();
                var l2 = library(), id = 'd' + now();
                var d = blankDoc();
                l2.unshift({ id: id, name: t('新草稿', 'New draft'), doc: d, updatedAt: now() });
                setArr('library', l2.slice(0, 20));
                Store.set(ak('current'), id);
                C.set(d); closeDrawer(); showLibrary();
                toast(t('已新建草稿', 'New draft created'));
            };
            el('dpExportBackup').onclick = function () { UI.openBackup(); };
            Array.prototype.forEach.call(box.querySelectorAll('.dp-list-item'), function (item) {
                var id = item.dataset.id;
                Array.prototype.forEach.call(item.querySelectorAll('[data-act]'), function (b) {
                    b.onclick = function (e) {
                        e.stopPropagation();
                        var act = b.dataset.act, l3 = library();
                        if (act === 'open') {
                            if (id === currentId()) { closeDrawer(); return; }
                            persistCurrent();
                            var target = l3.filter(function (x) { return x.id === id; })[0];
                            Store.set(ak('current'), id);
                            if (target) C.set(clone(target.doc));
                            lastWordTotal = C.wordCount();
                            closeDrawer(); toast(t('已切换草稿', 'Draft switched'));
                        } else if (act === 'rename') {
                            var e2 = l3.filter(function (x) { return x.id === id; })[0]; if (!e2) return;
                            var name = prompt(t('草稿名称', 'Draft name'), e2.name || '');
                            if (name === null) return;
                            e2.name = name.trim() || e2.name;
                            setArr('library', l3); showLibrary();
                        } else if (act === 'del') {
                            if (l3.length <= 1) { toast(t('至少保留一份草稿', 'Keep at least one draft')); return; }
                            if (!confirm(t('删除这份草稿？此操作不可撤销。', 'Delete this draft? This cannot be undone.'))) return;
                            var removed = l3.filter(function (x) { return x.id === id; })[0];
                            var l4 = l3.filter(function (x) { return x.id !== id; });
                            setArr('library', l4);
                            if (id === currentId()) {
                                Store.set(ak('current'), l4[0].id);
                                C.set(clone(l4[0].doc));
                            }
                            if (UI.showUndo) UI.showUndo(t('草稿已删除', 'Draft deleted'), function () {
                                var l5 = library(); l5.unshift(removed); setArr('library', l5);
                            });
                            showLibrary();
                        }
                    };
                });
            });
        });
    }

    /* ---------------- 45 / 83 版本快照与自动历史 ---------------- */
    function versions() { return arr('versions'); }
    function pushVersion(label, docData) {
        var v = versions();
        v.unshift({ id: 'v' + now(), at: now(), label: label, doc: docData || currentDoc() });
        setArr('versions', v.slice(0, 20));
    }
    function showVersions() {
        var v = versions();
        var html = '<p class="ll-note">' + esc(t('最多保留 20 份快照，写满后自动淘汰最旧的。系统每 5 分钟或每写 500 字也会自动存一份。', 'Up to 20 snapshots are kept; an automatic one is saved every 5 minutes or every 500 characters.')) + '</p>' +
            '<div class="ll-row"><button type="button" class="rd-btn primary" id="dpSnap">＋ ' + esc(t('立即存快照', 'Save snapshot now')) + '</button></div>' +
            '<div class="dp-list">' + (v.length ? v.map(function (x) {
                return '<div class="dp-list-item" data-id="' + esc(x.id) + '"><div><b>' + esc(x.label) + '</b><small>' + new Date(x.at).toLocaleString() + ' · ' +
                    (x.doc.chapters || []).length + esc(t(' 章', ' chapters')) + '</small></div>' +
                    '<div class="dp-item-actions"><button type="button" data-act="restore">' + esc(t('恢复', 'Restore')) + '</button><button type="button" data-act="del">×</button></div></div>';
            }).join('') : '<div class="ll-empty">' + esc(t('还没有快照', 'No snapshots yet')) + '</div>') + '</div>';
        openDrawer(t('历史版本', 'Version history'), html, function (box) {
            el('dpSnap').onclick = function () {
                var name = prompt(t('给这份快照起个名字', 'Name this snapshot'), t('手动快照', 'Manual snapshot'));
                if (name === null) return;
                pushVersion(name.trim() || t('手动快照', 'Manual snapshot'));
                showVersions(); toast(t('快照已保存', 'Snapshot saved'));
            };
            Array.prototype.forEach.call(box.querySelectorAll('.dp-list-item'), function (item) {
                var id = item.dataset.id;
                Array.prototype.forEach.call(item.querySelectorAll('[data-act]'), function (b) {
                    b.onclick = function () {
                        var v2 = versions(), e = v2.filter(function (x) { return x.id === id; })[0];
                        if (!e) return;
                        if (b.dataset.act === 'restore') {
                            if (!confirm(t('用这份快照替换当前内容？建议先存一份快照。', 'Replace current content with this snapshot? Save one first if unsure.'))) return;
                            pushVersion(t('恢复前自动备份', 'Auto-backup before restore'));
                            C.set(clone(e.doc)); closeDrawer(); toast(t('已恢复到该版本', 'Version restored'));
                        } else {
                            setArr('versions', v2.filter(function (x) { return x.id !== id; })); showVersions();
                        }
                    };
                });
            });
        });
    }
    function beforeSave(draftObj) {
        try {
            persistCurrent();
            var total = (draftObj.chapters || []).reduce(function (n, c) { return n + ((c.paragraphs || []).join('').length); }, 0);
            var delta = total - lastWordTotal;
            if (delta > 0 && delta < 5000) Store.mergeDaily(day(), { words: delta });
            lastWordTotal = total;
            if (now() - autoVersionAt > 5 * 60 * 1000) {
                autoVersionAt = now();
                pushVersion(t('自动快照', 'Auto snapshot'), clone(draftObj));
            }
        } catch (e) { warn('beforeSave', e); }
    }

    /* ---------------- 82 回收站 ---------------- */
    function trash() { return arr('trash'); }
    function showTrash() {
        var tr = trash();
        var html = '<p class="ll-note">' + esc(t('删除的章节会先放这里，可以随时恢复。', 'Deleted chapters land here and can be restored any time.')) + '</p>' +
            '<div class="dp-list">' + (tr.length ? tr.map(function (x) {
                return '<div class="dp-list-item" data-id="' + esc(x.id) + '"><div><b>' + esc((x.chapter && x.chapter.title) || t('未命名章节', 'Untitled chapter')) + '</b>' +
                    '<small>' + new Date(x.at).toLocaleString() + ' · ' + ((x.chapter && x.chapter.paragraphs || []).join('').length) + esc(t(' 字', ' chars')) + '</small></div>' +
                    '<div class="dp-item-actions"><button type="button" data-act="restore">' + esc(t('恢复', 'Restore')) + '</button><button type="button" data-act="del">×</button></div></div>';
            }).join('') : '<div class="ll-empty">' + esc(t('回收站是空的', 'Trash is empty')) + '</div>') + '</div>';
        openDrawer(t('回收站', 'Trash'), html, function (box) {
            Array.prototype.forEach.call(box.querySelectorAll('.dp-list-item'), function (item) {
                var id = item.dataset.id;
                Array.prototype.forEach.call(item.querySelectorAll('[data-act]'), function (b) {
                    b.onclick = function () {
                        var tr2 = trash(), e = tr2.filter(function (x) { return x.id === id; })[0]; if (!e) return;
                        if (b.dataset.act === 'restore') {
                            var d = C.get();
                            d.chapters[C.getCur()] && (d.chapters[C.getCur()].title = el('chapTitle').value,
                                d.chapters[C.getCur()].paragraphs = C.splitParas(el('chapBody').value));
                            var idx = Math.min(e.index || 0, d.chapters.length);
                            d.chapters.splice(idx, 0, clone(e.chapter));
                            setArr('trash', tr2.filter(function (x) { return x.id !== id; }));
                            C.set(d); C.setCur(idx); C.save(); closeDrawer();
                            toast(t('章节已恢复', 'Chapter restored'));
                        } else {
                            setArr('trash', tr2.filter(function (x) { return x.id !== id; })); showTrash();
                        }
                    };
                });
            });
        });
    }

    /* ---------------- 76 / 77 分卷、大纲、人物卡、设定集 ---------------- */
    function storyboard() {
        var d = C.get();
        if (!d.storyboard) d.storyboard = { outline: '', characters: [], settings: '' };
        if (!Array.isArray(d.storyboard.characters)) d.storyboard.characters = [];
        return d.storyboard;
    }
    function showStoryboard() {
        var sb = storyboard(), d = C.get();
        var vols = {};
        (d.chapters || []).forEach(function (c) { if (c.volume) vols[c.volume] = (vols[c.volume] || 0) + 1; });
        var chars = sb.characters.map(function (c, i) {
            return '<div class="dp-char" data-i="' + i + '"><input data-f="name" value="' + esc(c.name || '') + '" placeholder="' + esc(t('姓名', 'Name')) + '">' +
                '<input data-f="role" value="' + esc(c.role || '') + '" placeholder="' + esc(t('身份', 'Role')) + '">' +
                '<input data-f="note" value="' + esc(c.note || '') + '" placeholder="' + esc(t('备注', 'Notes')) + '">' +
                '<button type="button" data-del="' + i + '">×</button></div>';
        }).join('');
        var html =
            '<h4>' + esc(t('分卷', 'Volumes')) + '</h4>' +
            '<p class="ll-note">' + esc(t('给当前章节归入一个卷，章节列表会按卷分组显示。', 'Assign the current chapter to a volume; the chapter list groups by volume.')) + '</p>' +
            '<div class="ll-row"><select id="dpVolSel"><option value="">' + esc(t('（不分卷）', 'No volume')) + '</option>' +
            Object.keys(vols).map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + ' (' + vols[v] + ')</option>'; }).join('') + '</select>' +
            '<input type="text" id="dpVolNew" placeholder="' + esc(t('新卷名', 'New volume')) + '">' +
            '<button type="button" class="rd-btn" id="dpVolAssign">' + esc(t('归入 / 新建', 'Assign / create')) + '</button></div>' +
            '<h4>' + esc(t('全书大纲', 'Outline')) + '</h4><textarea id="dpOutline" rows="5" placeholder="' + esc(t('故事主线、章节安排……', 'Story arc, chapter plan…')) + '">' + esc(sb.outline || '') + '</textarea>' +
            '<h4>' + esc(t('设定集', 'Settings')) + '</h4><textarea id="dpSettings" rows="3" placeholder="' + esc(t('世界观、时代背景、规则……', 'World, era, rules…')) + '">' + esc(sb.settings || '') + '</textarea>' +
            '<h4>' + esc(t('人物卡', 'Characters')) + '</h4><div id="dpChars">' + chars + '</div>' +
            '<div class="ll-row"><button type="button" class="rd-btn" id="dpAddChar">＋ ' + esc(t('添加人物', 'Add character')) + '</button>' +
            '<button type="button" class="rd-btn" id="dpNameGen">🎲 ' + esc(t('随机取名', 'Random name')) + '</button>' +
            '<button type="button" class="rd-btn primary" id="dpSaveSb">' + esc(t('保存', 'Save')) + '</button></div>' +
            '<div id="dpNameOut" class="dp-name-out"></div>';
        openDrawer(t('大纲与设定', 'Outline & story bible'), html, function (box) {
            var curVol = (d.chapters[C.getCur()] || {}).volume || '';
            el('dpVolSel').value = curVol;
            el('dpVolAssign').onclick = function () {
                var name = (el('dpVolNew').value || '').trim() || el('dpVolSel').value || '';
                C.sync();
                d.chapters[C.getCur()].volume = name;
                if (!name) delete d.chapters[C.getCur()].volume;
                C.render(); C.save(); decorateChapters(); showStoryboard();
            };
            el('dpAddChar').onclick = function () {
                var s = storyboard(); s.characters.push({ name: '', role: '', note: '' }); C.save(); showStoryboard();
            };
            Array.prototype.forEach.call(box.querySelectorAll('.dp-char [data-del]'), function (b) {
                b.onclick = function () { storyboard().characters.splice(parseInt(b.dataset.del, 10), 1); C.save(); showStoryboard(); };
            });
            Array.prototype.forEach.call(box.querySelectorAll('.dp-char input'), function (inp) {
                inp.onchange = function () {
                    var i = parseInt(inp.parentNode.dataset.i, 10);
                    storyboard().characters[i][inp.dataset.f] = inp.value;
                    C.save();
                };
            });
            el('dpNameGen').onclick = function () { el('dpNameOut').textContent = randomName(); };
            el('dpSaveSb').onclick = function () {
                var s = storyboard();
                s.outline = el('dpOutline').value;
                s.settings = el('dpSettings').value;
                C.save(); toast(t('大纲已保存', 'Story bible saved'));
            };
        });
    }

    /* ---------------- 78 自动取名 ---------------- */
    var SURNAMES = '林沈顾苏叶白陆江许温宋谢云楚秦穆柳'.split('');
    var GIVEN = '清和知远言舟晚星砚书寒栖微澜照眠辞月川屿笙'.split('');
    var PLACES = '青梧镇、云隐山、听雨楼、长明街、落霞渡、无涯海、霜华谷'.split('、');
    var MOVES = '流云十三式、月照大江、一剑霜寒、青冥斩、回风拂柳'.split('、');
    function randomName(type) {
        function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
        type = type || 'person';
        if (type === 'place') return pick(PLACES);
        if (type === 'move') return pick(MOVES);
        return pick(SURNAMES) + pick(GIVEN) + (Math.random() < .4 ? pick(GIVEN) : '');
    }

    /* ---------------- 47 查找替换 ---------------- */
    function showFind() {
        var html = '<div class="dp-field"><label>' + esc(t('查找', 'Find')) + '</label><input type="text" id="dpFind"></div>' +
            '<div class="dp-field"><label>' + esc(t('替换为', 'Replace with')) + '</label><input type="text" id="dpReplace"></div>' +
            '<div class="ll-row"><button type="button" class="rd-btn" id="dpFindGo">' + esc(t('查找', 'Find')) + '</button>' +
            '<button type="button" class="rd-btn primary" id="dpReplaceAll">' + esc(t('全部替换', 'Replace all')) + '</button></div>' +
            '<div id="dpFindResults" class="dp-find-results"></div>';
        openDrawer(t('全文查找替换', 'Find & replace'), html, function (box) {
            function hits() {
                var q = el('dpFind').value.trim(); if (!q) return [];
                var d = C.get(), out = [];
                (d.chapters || []).forEach(function (c, ci) {
                    (c.paragraphs || []).forEach(function (p, pi) {
                        if (String(p).indexOf(q) >= 0) out.push({ ci: ci, pi: pi, text: String(p) });
                    });
                });
                return out;
            }
            el('dpFindGo').onclick = function () {
                var list = hits(), q = el('dpFind').value.trim();
                el('dpFindResults').innerHTML = list.length ? list.slice(0, 40).map(function (h) {
                    var i = h.text.indexOf(q);
                    return '<button type="button" class="dp-hit" data-ci="' + h.ci + '" data-pi="' + h.pi + '">' +
                        '<small>' + esc((C.get().chapters[h.ci] || {}).title || ('# ' + (h.ci + 1))) + '</small>' +
                        esc(h.text.slice(Math.max(0, i - 20), i + 60)) + '</button>';
                }).join('') : '<div class="ll-empty">' + esc(t('没有找到', 'No matches')) + '</div>';
                Array.prototype.forEach.call(el('dpFindResults').querySelectorAll('.dp-hit'), function (b) {
                    b.onclick = function () { C.setCur(parseInt(b.dataset.ci, 10)); closeDrawer(); };
                });
            };
            el('dpReplaceAll').onclick = function () {
                var q = el('dpFind').value, r = el('dpReplace').value;
                if (!q) return;
                C.sync();
                var n = 0, d = C.get();
                (d.chapters || []).forEach(function (c) {
                    c.paragraphs = (c.paragraphs || []).map(function (p) {
                        var parts = String(p).split(q); n += parts.length - 1; return parts.join(r);
                    });
                });
                C.render(); C.save();
                toast(t('已替换 ', 'Replaced ') + n + t(' 处', ' matches'));
            };
        });
    }

    /* ---------------- 51 导入 Markdown ---------------- */
    function importMarkdown() {
        var inp = node('input'); inp.type = 'file'; inp.accept = '.md,.markdown,.txt,text/markdown,text/plain';
        inp.onchange = function () {
            var f = inp.files && inp.files[0]; if (!f) return;
            var r = new FileReader();
            r.onload = function () {
                try {
                    var lines = String(r.result).split(/\r?\n/), d = blankDoc();
                    var curCh = null, buf = [];
                    function flush() {
                        var paras = buf.join('\n').split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
                        if (curCh) { curCh.paragraphs = paras; d.chapters.push(curCh); }
                        buf = [];
                    }
                    lines.forEach(function (ln) {
                        if (/^#\s+/.test(ln)) d.title_zh = ln.replace(/^#\s+/, '').trim();
                        else if (/^##\s+/.test(ln)) { flush(); curCh = { title: ln.replace(/^##\s+/, '').trim(), paragraphs: [] }; }
                        else buf.push(ln);
                    });
                    flush();
                    if (!d.chapters.length) d.chapters = [{ title: t('正文', 'Text'), paragraphs: buf.join('\n').split(/\n\s*\n/).filter(Boolean) }];
                    C.set(d); C.save();
                    toast(t('Markdown 已导入', 'Markdown imported'));
                } catch (e) { warn('md', e); toast(t('导入失败', 'Import failed')); }
            };
            r.readAsText(f);
        };
        inp.click();
    }

    /* ---------------- 52 投稿预填 ---------------- */
    function submitToTally() {
        C.sync();
        var d = C.get();
        var q = 'submit-title=' + encodeURIComponent(d.title_zh || d.title_en || '') +
            '&submit-author=' + encodeURIComponent(C.getAuthorId() || '') +
            '&submit-words=' + C.wordCount();
        location.href = 'dashboard.html#' + q;
    }

    /* ---------------- 54 敏感词 / 错别字检查 ---------------- */
    var TYPOS = [['帐号', '账号'], ['登陆', '登录'], ['按装', '安装'], ['既使', '即使'], ['迫不急待', '迫不及待'], ['一如继往', '一如既往'], ['不径而走', '不胫而走'], ['再接再励', '再接再厉'], ['默守成规', '墨守成规'], ['金榜提名', '金榜题名']];
    function showProofread() {
        C.sync();
        var d = C.get(), issues = [];
        (d.chapters || []).forEach(function (c, ci) {
            (c.paragraphs || []).forEach(function (p, pi) {
                TYPOS.forEach(function (pair) {
                    if (String(p).indexOf(pair[0]) >= 0) issues.push({ ci: ci, pi: pi, bad: pair[0], good: pair[1] });
                });
            });
        });
        var html = '<p class="ll-note">' + esc(t('基于本地常见错别字词库的轻量检查，仅覆盖高频误用，不能替代人工校对。', 'A lightweight local typo dictionary. It covers common mistakes only and is no substitute for proofreading.')) + '</p>' +
            (issues.length ? '<div class="dp-list">' + issues.map(function (x) {
                return '<button type="button" class="dp-hit" data-ci="' + x.ci + '" data-pi="' + x.pi + '"><small>' + esc((d.chapters[x.ci] || {}).title || '') + ' · ' + (x.pi + 1) + '</small>' +
                    esc(x.bad) + ' → <b>' + esc(x.good) + '</b></button>';
            }).join('') + '</div>' : '<div class="ll-empty">✓ ' + esc(t('没有发现常见错别字', 'No common typos found')) + '</div>');
        openDrawer(t('错别字检查', 'Proofreading'), html, function (box) {
            Array.prototype.forEach.call(box.querySelectorAll('.dp-hit'), function (b) {
                b.onclick = function () { C.setCur(parseInt(b.dataset.ci, 10)); closeDrawer(); };
            });
        });
    }

    /* ---------------- 43 / 50 目标环与日更曲线 ---------------- */
    function goal() { return Number(Store.get(ak('goal'), 2000)) || 2000; }
    function ringHtml() {
        var g = goal(), w = todayWords(), pct = Math.min(1, w / g);
        var r = 34, c = 2 * Math.PI * r;
        return '<svg width="84" height="84" viewBox="0 0 84 84"><circle cx="42" cy="42" r="' + r + '" fill="none" stroke="var(--border-color)" stroke-width="7"/>' +
            '<circle cx="42" cy="42" r="' + r + '" fill="none" stroke="var(--primary)" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - pct)) + '"/></svg>' +
            '<span class="ll-ring-label">' + Math.round(pct * 100) + '%</span>';
    }
    function showGoals() {
        var d = Store.daily(), series = [], max = 1;
        for (var i = 6; i >= 0; i--) {
            var dt = new Date(); dt.setDate(dt.getDate() - i);
            var w = (d[UI.dayKey(dt)] || {}).words || 0;
            series.push({ label: (dt.getMonth() + 1) + '/' + dt.getDate(), w: w });
            max = Math.max(max, w);
        }
        var bars = series.map(function (s) {
            return '<div class="ll-bar-wrap"><div class="ll-bar' + (s.w ? '' : ' dim') + '" style="height:' + Math.max(3, s.w / max * 76) + 'px"></div><span class="ll-bar-label">' + esc(s.label) + '</span></div>';
        }).join('');
        var html = '<div class="dp-goal-row"><div class="ll-ring" id="dpRing">' + ringHtml() + '</div>' +
            '<div><p class="ll-note">' + esc(t('今日已写 ', 'Written today: ')) + todayWords() + esc(t(' 字，目标 ', ' chars, goal ')) + goal() + esc(t(' 字', ' chars')) + '</p>' +
            '<div class="dp-field"><label>' + esc(t('每日字数目标', 'Daily word goal')) + '</label><input type="number" id="dpGoal" min="100" step="100" value="' + goal() + '"></div>' +
            '<label class="rp-toggle"><input type="checkbox" id="dpSound"' + (soundOn ? ' checked' : '') + '> ' + esc(t('打字音效', 'Typing sounds')) + '</label>' +
            '<label class="rp-toggle"><input type="checkbox" id="dpAutoScroll"' + (Store.get(ak('autoscroll'), false) === true ? ' checked' : '') + '> ' + esc(t('自动滚屏', 'Auto-scroll')) + '</label></div></div>' +
            '<h4>' + esc(t('近 7 天码字', 'Last 7 days')) + '</h4><div class="ll-bars">' + bars + '</div>' +
            '<div class="ll-row"><button type="button" class="rd-btn primary" id="dpSaveGoal">' + esc(t('保存设置', 'Save settings')) + '</button></div>';
        openDrawer(t('码字目标', 'Writing goals'), html, function () {
            el('dpSaveGoal').onclick = function () {
                Store.set(ak('goal'), parseInt(el('dpGoal').value, 10) || 2000);
                soundOn = !!el('dpSound').checked; Store.set(ak('sound'), soundOn);
                Store.set(ak('autoscroll'), !!el('dpAutoScroll').checked);
                updateRing(); toast(t('设置已保存', 'Settings saved'));
            };
        });
    }
    function updateRing() {
        if (!ringEl) return;
        ringEl.innerHTML = ringHtml();
        ringEl.title = t('今日字数 / 目标', 'Today / goal');
    }

    /* ---------------- 44 打字音效 ---------------- */
    var audioCtx = null;
    function tick() {
        if (!soundOn) return;
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            var o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = 'sine'; o.frequency.value = 620 + Math.random() * 90;
            g.gain.setValueAtTime(0.012, audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.035);
            o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.04);
        } catch (e) { /* 静默 */ }
    }

    /* ---------------- 46 富文本 / 85 斜杠命令 ---------------- */
    function insertAround(before, after) {
        var ta = el('chapBody'); if (!ta) return;
        var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
        ta.value = v.slice(0, s) + before + v.slice(s, e) + after + v.slice(e);
        ta.focus(); ta.setSelectionRange(s + before.length, e + before.length);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function buildFormatBar() {
        var paper = el('paper'); if (!paper || el('dpFormat')) return;
        var bar = node('div', 'dp-format'); bar.id = 'dpFormat';
        bar.innerHTML =
            '<button type="button" data-f="b" title="Bold"><b>B</b></button>' +
            '<button type="button" data-f="i" title="Italic"><i>I</i></button>' +
            '<button type="button" data-f="h" title="Heading">H2</button>' +
            '<button type="button" data-f="q" title="Quote">❝</button>' +
            '<button type="button" data-f="hr" title="Divider">—</button>' +
            '<button type="button" data-f="date" title="Date">📅</button>' +
            '<span class="dp-save-state" id="dpSaveState"></span>';
        paper.insertBefore(bar, paper.firstChild);
        Array.prototype.forEach.call(bar.querySelectorAll('[data-f]'), function (b) {
            b.onclick = function () {
                var f = b.dataset.f;
                if (f === 'b') return insertAround('**', '**');
                if (f === 'i') return insertAround('*', '*');
                if (f === 'h') return insertAtLine('## ');
                if (f === 'q') return insertAtLine('> ');
                if (f === 'hr') return insertAround('\n\n---\n\n', '');
                if (f === 'date') return insertAround(new Date().toLocaleDateString(), '');
            };
        });
        saveStateEl = el('dpSaveState');
    }
    function insertAtLine(prefix) {
        var ta = el('chapBody'); if (!ta) return;
        var s = ta.selectionStart, lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
        ta.value = ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart);
        ta.focus(); ta.setSelectionRange(s + prefix.length, s + prefix.length);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function initSlash() {
        var ta = el('chapBody'); if (!ta) return;
        ta.addEventListener('keydown', function (e) {
            if (e.key !== '/') return;
            var s = ta.selectionStart;
            if (s > 0 && /\S/.test(ta.value[s - 1])) return;
            e.preventDefault(); showSlash(ta, s);
        });
    }
    function showSlash(ta, pos) {
        var menu = el('dpSlash');
        if (!menu) { menu = node('div', 'dp-slash'); menu.id = 'dpSlash'; doc.body.appendChild(menu); }
        var items = [
            ['h2', t('二级标题', 'Heading'), '## '], ['quote', t('引用', 'Quote'), '> '],
            ['hr', t('分隔线', 'Divider'), '\n---\n'], ['role', t('剧本角色行', 'Script line'), t('角色：', 'Role: ')],
            ['date', t('今天日期', 'Today'), new Date().toLocaleDateString() + ' '],
            ['name', t('随机人名', 'Random name'), randomName() + ' ']
        ];
        menu.innerHTML = items.map(function (x) { return '<button type="button" data-v="' + esc(x[2]) + '">' + esc(x[1]) + '</button>'; }).join('');
        var r = ta.getBoundingClientRect();
        menu.style.left = Math.min(r.left + 24, window.innerWidth - 200) + 'px';
        menu.style.top = Math.min(r.top + 70, window.innerHeight - 220) + 'px';
        menu.hidden = false;
        menu.onclick = function (e) {
            var b = e.target.closest('button'); if (!b) return;
            menu.hidden = true;
            ta.value = ta.value.slice(0, pos) + b.dataset.v + ta.value.slice(ta.selectionStart);
            ta.focus(); ta.setSelectionRange(pos + b.dataset.v.length, pos + b.dataset.v.length);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setTimeout(function () {
            doc.addEventListener('click', function once(e) {
                if (menu && !menu.contains(e.target)) { menu.hidden = true; doc.removeEventListener('click', once); }
            });
        }, 0);
    }

    /* ---------------- 79 双符号补齐 / 81 自动滚屏 ---------------- */
    var PAIRS = { '「': '」', '“': '”', '‘': '’', '《': '》', '（': '）', '【': '】', '(': ')', '[': ']' };
    function initTypingHelpers() {
        var ta = el('chapBody'); if (!ta) return;
        ta.addEventListener('keydown', function (e) {
            if (PAIRS[e.key]) {
                var s = ta.selectionStart, en = ta.selectionEnd;
                if (s !== en) {
                    e.preventDefault();
                    ta.value = ta.value.slice(0, s) + e.key + ta.value.slice(s, en) + PAIRS[e.key] + ta.value.slice(en);
                    ta.setSelectionRange(s + 1, en + 1);
                } else {
                    e.preventDefault();
                    ta.value = ta.value.slice(0, s) + e.key + PAIRS[e.key] + ta.value.slice(s);
                    ta.setSelectionRange(s + 1, s + 1);
                }
                ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        ta.addEventListener('input', function () {
            if (Store.get(ak('autoscroll'), false) !== true) return;
            var lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 28;
            var before = ta.value.slice(0, ta.selectionStart).split('\n').length;
            var target = (before - 3) * lineHeight;
            if (target > ta.scrollTop + ta.clientHeight * 0.3) ta.scrollTop = Math.max(0, target - ta.clientHeight * 0.4);
        });
    }

    /* ---------------- 76 / 48 / 49 章节列表增强 ---------------- */
    var decorating = false;
    function decorateChapters() {
        if (decorating) return;
        decorating = true;
        try {
            var list = el('chapList'); if (!list) return;
            var d = C.get(), lastVol = null;
            Array.prototype.slice.call(list.querySelectorAll('.chap-item')).forEach(function (item) {
                if (item.dataset.dp === '1') return;
                item.dataset.dp = '1';
                var idx = parseInt(item.dataset.idx, 10);
                var ch = (d.chapters || [])[idx] || {};
                var vol = ch.volume || '';
                if (vol && vol !== lastVol) {
                    var head = node('div', 'dp-vol-head', '📁 ' + esc(vol));
                    list.insertBefore(head, item);
                }
                lastVol = vol;
                var words = ((ch.paragraphs || []).join('').length);
                var small = node('small', 'dp-wc', words + ' ' + t('字', 'c'));
                item.appendChild(small);
                if (vol) item.classList.add('has-vol');
                item.draggable = true;
                item.addEventListener('dragstart', function (e) {
                    e.dataTransfer.setData('text/plain', String(idx));
                    item.classList.add('ll-sortable');
                });
                item.addEventListener('dragend', function () { item.classList.remove('ll-sortable'); });
                item.addEventListener('dragover', function (e) { e.preventDefault(); });
                item.addEventListener('drop', function (e) {
                    e.preventDefault();
                    var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                    if (isNaN(from) || from === idx) return;
                    var d = C.get();
                    d.chapters[C.getCur()] && (d.chapters[C.getCur()].title = el('chapTitle').value,
                        d.chapters[C.getCur()].paragraphs = C.splitParas(el('chapBody').value));
                    var moving = d.chapters.splice(from, 1)[0];
                    d.chapters.splice(idx, 0, moving);
                    C.set(d); C.setCur(idx); renumber(); C.save();
                    toast(t('章节顺序已调整', 'Chapters reordered'));
                });
            });
        } finally { decorating = false; }
    }
    function renumber() {
        var d = C.get(), changed = false;
        (d.chapters || []).forEach(function (c, i) {
            if (/^第\s*\d+\s*章$/.test(c.title || '')) {
                var v = t('第 ', 'Chapter ') + (i + 1) + t('章', '');
                if (v !== c.title) { c.title = v; changed = true; }
            }
        });
        if (changed) C.render();
    }

    /* ---------------- 42 专注模式 ---------------- */
    function toggleFocus() {
        focusOn = !focusOn;
        doc.body.classList.toggle('dp-focus', focusOn);
        toast(focusOn ? t('专注模式已开启（Esc 退出）', 'Focus mode on (Esc to exit)') : t('专注模式已关闭', 'Focus mode off'));
    }

    /* ---------------- 浮动工具坞 ---------------- */
    var ITEMS = [
        ['library', '📚', '我的草稿', 'My drafts', showLibrary],
        ['storyboard', '🗂', '大纲与分卷', 'Outline & volumes', showStoryboard],
        ['versions', '🕘', '历史版本', 'Version history', showVersions],
        ['trash', '🗑', '回收站', 'Trash', showTrash],
        ['find', '🔍', '查找替换', 'Find & replace', showFind],
        ['proof', '🔎', '错别字检查', 'Proofreading', showProofread],
        ['goals', '🎯', '码字目标', 'Writing goals', showGoals],
        ['md', '📥', '导入 Markdown', 'Import Markdown', importMarkdown],
        ['submit', '📨', '投稿（预填）', 'Submit (prefilled)', submitToTally],
        ['focus', '🧘', '专注模式', 'Focus mode', toggleFocus]
    ];
    function buildDock() {
        dock = node('div', 'dp-dock'); dock.id = 'dpDock';
        dock.innerHTML = '<button type="button" class="dp-dock-toggle" id="dpDockToggle">✦</button><div class="dp-dock-items">' +
            ITEMS.map(function (it) {
                return '<button type="button" data-id="' + it[0] + '" title="' + esc(t(it[2], it[3])) + '">' + it[1] + '<span>' + esc(t(it[2], it[3])) + '</span></button>';
            }).join('') + '</div>';
        doc.body.appendChild(dock);
        el('dpDockToggle').onclick = function () { dock.classList.toggle('open'); };
        Array.prototype.forEach.call(dock.querySelectorAll('[data-id]'), function (b) {
            b.onclick = function () {
                var it = ITEMS.filter(function (x) { return x[0] === b.dataset.id; })[0];
                if (it) try { it[4](); } catch (e) { warn('dock:' + it[0], e); }
            };
        });
        ringEl = node('div', 'dp-ring-btn'); ringEl.id = 'dpRingBtn';
        ringEl.title = t('今日码字进度', 'Today\'s progress');
        ringEl.onclick = showGoals;
        doc.body.appendChild(ringEl);
        updateRing();
    }

    /* ---------------- 事件与初始化 ---------------- */
    function bindEvents() {
        window.addEventListener('draftSaveState', function (e) {
            dirty = e.detail !== 'saved';
            if (saveStateEl) {
                saveStateEl.textContent = e.detail === 'saving' ? '● ' + t('保存中…', 'Saving…') :
                    e.detail === 'error' ? '⚠ ' + t('保存失败', 'Save failed') : '✓ ' + t('已保存', 'Saved');
                saveStateEl.dataset.state = e.detail;
            }
        });
        window.addEventListener('draftInput', function () {
            tick();
            clearTimeout(bindEvents._rt);
            bindEvents._rt = setTimeout(updateRing, 800);
        });
        window.addEventListener('draftChapterDeleted', function (e) {
            var tr = trash();
            tr.unshift({ id: 't' + now(), chapter: e.detail.chapter, index: e.detail.index, at: now() });
            setArr('trash', tr.slice(0, 30));
            renumber();
            if (UI.showUndo) UI.showUndo(t('章节已移入回收站', 'Chapter moved to trash'), function () {
                var tr2 = trash(), item = tr2.shift();
                setArr('trash', tr2);
                if (item) {
                    C.sync();
                    C.get().chapters.splice(item.index, 0, item.chapter);
                    C.setCur(item.index); C.render(); C.save();
                }
            });
        });
        window.addEventListener('draftChapterAdded', function () { renumber(); });
        window.addEventListener('draftReplaced', function () {
            lastWordTotal = 0; ensureLibrary(); persistCurrent(); decorateChapters();
        });
        window.addEventListener('langChanged', function () { updateRing(); decorateChapters(); });
        window.addEventListener('beforeunload', function (e) {
            if (!dirty) return;
            e.preventDefault(); e.returnValue = '';
        });
        doc.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && focusOn) { toggleFocus(); return; }
            var typing = /input|textarea/i.test((e.target.tagName || ''));
            if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); showSlash(el('chapBody'), (el('chapBody') || {}).selectionStart || 0); return; }
            if (e.key === 'F1') { e.preventDefault(); UI.openHelp(); }
        });
        if ('MutationObserver' in window) {
            var list = el('chapList');
            if (list) new MutationObserver(function () { setTimeout(decorateChapters, 20); }).observe(list, { childList: true });
        }
        Bus.on('storage', function (p) {
            if (p.self) return;
            if (p.key === 'daily') updateRing();
        });
        Bus.on('daily', updateRing);
    }

    function registerCommands() {
        ITEMS.forEach(function (it) {
            UI.registerCommand({
                id: 'dp-' + it[0], zh: it[2], en: it[3], icon: it[1], section: 'Writing',
                run: it[4]
            });
        });
        UI.registerCommand({ id: 'dp-renumber', zh: '重排章节编号', en: 'Renumber chapters', icon: '№', section: 'Writing', run: renumber });
        UI.registerCommand({ id: 'dp-name', zh: '随机取一个名字', en: 'Generate a random name', icon: '🎲', section: 'Writing', run: function () {
            toast(randomName() + ' / ' + randomName('place') + ' / ' + randomName('move'));
        } });
    }

    function init() {
        if (window.__dpInited) return;
        window.__dpInited = true;
        C = window.DraftCore; L = window.Lelele;
        if (!C || !L) return;
        Store = L.Store; UI = L.UI; Bus = L.Bus; t = L.t; esc = L.esc;
        soundOn = Store.get(ak('sound'), false) === true;
        ensureLibrary();
        lastWordTotal = C.wordCount();
        buildFormatBar();
        buildDock();
        initSlash();
        initTypingHelpers();
        bindEvents();
        registerCommands();
        decorateChapters();
        updateRing();
        window.DraftPlus = { beforeSave: beforeSave, refresh: function () { decorateChapters(); updateRing(); } };
    }

    if (window.DraftCore) init();
    else doc.addEventListener('draftCoreReady', init, { once: true });
})();
