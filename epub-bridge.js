/* =========================================================
   epub-bridge.js - EPUB <-> JSON 双向转换（纯前端、零构建）
   EPUB -> BookContent JSON：上传后在线解析，立即进入统一阅读器
   BookContent JSON -> EPUB：站内任意书实时生成 Blob 下载，不预生成文件
   依赖：同域自托管 jszip.min.js（UMD，无 CDN、无 npm）
   ========================================================= */
window.EpubBridge = (function () {
    'use strict';

    const MAX_SIZE = 20 * 1024 * 1024;
    const ZIP_URL = '/jszip.min.js';
    let zipPromise = null;

    function toast(msg) { if (window.showToast) window.showToast(msg); else console.log('[EPUB] ' + msg); }
    function t(zh, en) { return (window.getLang && window.getLang() === 'en') ? en : zh; }

    function ensureJSZip() {
        if (window.JSZip) return Promise.resolve(window.JSZip);
        if (zipPromise) return zipPromise;
        zipPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = ZIP_URL;
            s.async = true;
            const timer = setTimeout(() => reject(new Error(t('解压组件加载超时', 'Unzip component timed out'))), 8000);
            s.onload = () => { clearTimeout(timer); window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip missing')); };
            s.onerror = () => { clearTimeout(timer); zipPromise = null; reject(new Error(t('解压组件加载失败', 'Failed to load unzip component'))); };
            document.head.appendChild(s);
        });
        return zipPromise;
    }

    /* ---------------- 通用工具 ---------------- */
    function xmlParse(text) {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error(t('EPUB 配置文件损坏', 'Corrupted EPUB configuration'));
        return doc;
    }
    function htmlParse(text) { return new DOMParser().parseFromString(text, 'text/html'); }
    function attr(el, name) { return el.getAttribute(name) || ''; }
    // 用 localName 匹配，兼容 OPF 的 dc:title、带默认命名空间的 container.xml 等
    function byTag(root, name) {
        return Array.from(root.getElementsByTagName('*')).filter(el => el.localName === name);
    }
    function byLocal(root, name) {
        return Array.from(root.getElementsByTagName('*')).filter(el => el.tagName.toLowerCase() === name.toLowerCase());
    }

    function normalizePath(p) {
        return decodeURIComponent(String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').split('#')[0].split('?')[0]);
    }
    function joinPath(base, rel) {
        const parts = (base ? base.split('/') : []).concat(String(rel || '').split('/'));
        const out = [];
        parts.forEach(seg => {
            if (!seg || seg === '.') return;
            if (seg === '..') out.pop();
            else out.push(seg);
        });
        return out.join('/');
    }
    function buildEntryMap(zip) {
        const map = {};
        Object.keys(zip.files).forEach(k => {
            if (zip.files[k].dir) return;
            map[normalizePath(k).toLowerCase()] = k;
        });
        return map;
    }
    function findEntry(map, path) {
        const key = normalizePath(path).toLowerCase();
        if (map[key]) return map[key];
        const base = key.split('/').pop();
        const loose = Object.keys(map).find(k => k.split('/').pop() === base);
        return loose ? map[loose] : null;
    }
    function escapeXml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
    }
    function safeName(s) { return String(s || 'book').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60); }

    /* ---------------- XHTML 清洗 ---------------- */
    const ALLOWED = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'SPAN', 'EM', 'STRONG', 'B', 'I',
        'BR', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'IMG', 'A', 'SECTION', 'ARTICLE', 'PRE', 'HR', 'TABLE', 'TR', 'TD', 'TH']);

    function cleanElement(root, rewriteSrc) {
        Array.from(root.querySelectorAll('*')).forEach(el => {
            if (!ALLOWED.has(el.tagName)) { el.remove(); return; }
            Array.from(el.attributes).forEach(a => {
                const n = a.name.toLowerCase(), v = a.value || '';
                if (n.indexOf('on') === 0 || /^(javascript|data|vbscript):/i.test(v.trim())) { el.removeAttribute(a.name); return; }
                if ((n === 'src' || n === 'href') && rewriteSrc) {
                    const out = rewriteSrc(v);
                    if (out) el.setAttribute(n, out);
                    else el.removeAttribute(n);
                }
                if (n === 'style' && /url\s*\(/i.test(v)) el.removeAttribute(n);
            });
            if (el.tagName === 'A') el.setAttribute('target', '_blank'), el.setAttribute('rel', 'noopener noreferrer');
        });
    }

    function extractParagraphs(body) {
        const out = [];
        const blocks = Array.from(body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li, pre'));
        const seen = new Set();
        blocks.forEach(b => {
            if (seen.has(b)) return;
            let node = b.parentElement, nested = false;
            while (node && node !== body) { if (seen.has(node)) { nested = true; break; } node = node.parentElement; }
            if (nested) return;
            const text = (b.textContent || '').replace(/\s+/g, ' ').trim();
            if (text) out.push(text);
            seen.add(b);
        });
        if (!out.length) {
            (body.textContent || '').split(/\n{2,}/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach(s => out.push(s));
        }
        return out;
    }

    /* ---------------- EPUB -> JSON ---------------- */
    async function parseEpubToBookContent(file, onProgress) {
        const JSZip = await ensureJSZip();
        if (!file) throw new Error(t('未选择文件', 'No file selected'));
        if (file.size > MAX_SIZE) throw new Error(t('文件超过 20MB', 'File exceeds 20MB'));

        const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: false });
        const map = buildEntryMap(zip);

        if (findEntry(map, 'META-INF/encryption.xml')) {
            throw new Error(t('不支持加密或带 DRM 的 EPUB', 'Encrypted / DRM EPUB is not supported'));
        }
        const containerKey = findEntry(map, 'META-INF/container.xml');
        if (!containerKey) throw new Error(t('不是有效的 EPUB（缺少 container.xml）', 'Not a valid EPUB (container.xml missing)'));

        const container = xmlParse(await zip.file(containerKey).async('string'));
        const rootfile = byTag(container, 'rootfile')[0];
        const opfPath = normalizePath(attr(rootfile || {}, 'full-path') || 'OEBPS/content.opf');
        const opfKey = findEntry(map, opfPath);
        if (!opfKey) throw new Error(t('找不到 OPF 文件', 'OPF file not found'));
        const opfDir = opfPath.indexOf('/') === -1 ? '' : opfPath.slice(0, opfPath.lastIndexOf('/'));

        const opf = xmlParse(await zip.file(opfKey).async('string'));
        const metaTitle = (byTag(opf, 'title')[0] || {}).textContent || file.name.replace(/\.epub$/i, '');
        const metaCreator = (byTag(opf, 'creator')[0] || {}).textContent || '';
        const metaLang = (byTag(opf, 'language')[0] || {}).textContent || 'zh';

        const manifest = {};
        byTag(opf, 'item').forEach(item => {
            manifest[attr(item, 'id')] = {
                href: attr(item, 'href'),
                type: attr(item, 'media-type'),
                props: attr(item, 'properties')
            };
        });
        const spineItems = byTag(opf, 'itemref').map(r => manifest[attr(r, 'idref')]).filter(Boolean);

        // 目录标签：EPUB3 nav 优先，EPUB2 ncx 回退
        const labels = {};
        const navItem = Object.values(manifest).find(m => (m.props || '').split(/\s+/).indexOf('nav') !== -1);
        const ncxItem = Object.values(manifest).find(m => /ncx/i.test(m.type || ''));
        async function collectLabels(item, isNcx) {
            if (!item) return;
            const key = findEntry(map, joinPath(opfDir, item.href));
            if (!key) return;
            const doc = xmlParse(await zip.file(key).async('string'));
            const base = key.slice(0, key.lastIndexOf('/') + 1);
            if (isNcx) {
                byTag(doc, 'navPoint').forEach(np => {
                    const label = (byTag(np, 'text')[0] || {}).textContent || '';
                    const src = attr(byTag(np, 'content')[0] || {}, 'src');
                    if (label && src) labels[normalizePath(joinPath(base, src)).toLowerCase()] = label.trim();
                });
            } else {
                byTag(doc, 'a').forEach(a => {
                    const label = (a.textContent || '').trim();
                    const href = attr(a, 'href');
                    if (label && href) labels[normalizePath(joinPath(base, href)).toLowerCase()] = label;
                });
            }
        }
        try { await collectLabels(navItem, false); } catch (e) { }
        if (!Object.keys(labels).length) { try { await collectLabels(ncxItem, true); } catch (e) { } }

        const chapters = [];
        let imageCount = 0;
        for (let i = 0; i < spineItems.length; i++) {
            const item = spineItems[i];
            const full = joinPath(opfDir, item.href);
            const entryKey = findEntry(map, full);
            if (!entryKey) continue;
            const raw = await zip.file(entryKey).async('string');
            const doc = htmlParse(raw);
            const body = doc.body;
            const entryDir = entryKey.slice(0, entryKey.lastIndexOf('/') + 1);

            // 图片相对路径 -> blob URL（限制数量，避免大书爆内存）
            const imgJobs = [];
            Array.from(body.querySelectorAll('img')).forEach(img => {
                const src = attr(img, 'src');
                if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
                if (imageCount > 80) { img.remove(); return; }
                imageCount++;
                const key = findEntry(map, joinPath(entryDir, src));
                if (!key) { img.remove(); return; }
                imgJobs.push(zip.file(key).async('blob').then(b => {
                    img.setAttribute('src', URL.createObjectURL(b));
                    img.removeAttribute('srcset');
                }).catch(() => img.remove()));
            });
            await Promise.all(imgJobs);

            cleanElement(body, v => /^(https?:|data:|blob:|#)/i.test(v.trim()) ? v : null);
            const paragraphs = extractParagraphs(body);
            if (!paragraphs.length) continue;

            const head = body.querySelector('h1, h2, h3');
            const headText = head ? head.textContent.replace(/\s+/g, ' ').trim() : '';
            const labelKey = normalizePath(full).toLowerCase();
            const title = (labels[labelKey] || headText || t('第 ', 'Chapter ') + (chapters.length + 1)).trim();
            // 标题若已作为块级元素被收进段落，去掉重复的第一段
            if (paragraphs.length && (paragraphs[0] === title || (headText && paragraphs[0] === headText))) paragraphs.shift();
            chapters.push({ title: title, paragraphs: paragraphs, html: body.innerHTML });
            if (onProgress) onProgress(i + 1, spineItems.length);
        }

        if (!chapters.length) throw new Error(t('未解析出任何章节', 'No chapters found in this EPUB'));
        return {
            id: 'epub_' + Date.now(),
            title: metaTitle.trim(),
            chapters: chapters,
            meta: { creator: metaCreator.trim(), language: metaLang, source: file.name }
        };
    }

    /* ---------------- JSON -> EPUB ---------------- */
    async function buildEpubFromBookContent(book, onProgress) {
        const JSZip = await ensureJSZip();
        if (!book || !Array.isArray(book.chapters) || !book.chapters.length) {
            throw new Error(t('没有可导出的章节', 'No chapters to export'));
        }
        const zip = new JSZip();
        const title = escapeXml(book.title || t('未命名书籍', 'Untitled'));
        const creator = escapeXml((book.meta && book.meta.creator) || '了了了读');
        const lang = escapeXml((book.meta && book.meta.language) || 'zh');
        const uid = 'urn:uuid:lelele-read-' + Date.now();

        // 第一个条目必须是不压缩的 mimetype
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
        zip.file('META-INF/container.xml',
            `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);

        const manifest = [], spine = [], navPoints = [], navItems = [];
        const chapterNames = [];
        for (let i = 0; i < book.chapters.length; i++) {
            const ch = book.chapters[i] || {};
            const name = `chapter-${i + 1}.xhtml`;
            chapterNames.push(name);
            const chapTitle = ch.title || (t('第 ', 'Chapter ') + (i + 1));
            let body;
            if (ch.paragraphs && ch.paragraphs.length) {
                body = ch.paragraphs.map(p => `<p>${escapeXml(p)}</p>`).join('\n');
            } else if (ch.html) {
                const doc = htmlParse(String(ch.html));
                cleanElement(doc.body, null);
                body = doc.body.innerHTML;
            } else {
                body = '<p></p>';
            }
            zip.file('OEBPS/' + name,
                `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"><head><title>${escapeXml(chapTitle)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h2>${escapeXml(chapTitle)}</h2>${body}</body></html>`);
            manifest.push(`<item id="chap${i + 1}" href="${name}" media-type="application/xhtml+xml"/>`);
            spine.push(`<itemref idref="chap${i + 1}"/>`);
            navPoints.push(`<navPoint id="navPoint-${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXml(chapTitle)}</text></navLabel><content src="${name}"/></navPoint>`);
            navItems.push(`<li><a href="${name}">${escapeXml(chapTitle)}</a></li>`);
            if (onProgress) onProgress(i + 1, book.chapters.length);
        }

        zip.file('OEBPS/style.css',
            `body{font-family:"Noto Serif SC",Songti SC,serif;line-height:1.9;font-size:1.05em;color:#1F2933;margin:1.2em}h2{color:#2F5D62;margin:1.6em 0 .8em}p{margin:.7em 0;text-indent:0}img{max-width:100%}`);
        zip.file('OEBPS/nav.xhtml',
            `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body><nav epub:type="toc" id="toc"><h1>${title}</h1><ol>${navItems.join('')}</ol></nav></body></html>`);
        zip.file('OEBPS/toc.ncx',
            `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/></head><docTitle><text>${title}</text></docTitle><navMap>${navPoints.join('')}</navMap></ncx>`);
        zip.file('OEBPS/content.opf',
            `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">` +
            `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="BookId">${uid}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${creator}</dc:creator><dc:language>${lang}</dc:language><meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta></metadata>` +
            `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>${manifest.join('')}</manifest>` +
            `<spine toc="ncx">${spine.join('')}</spine></package>`);

        return await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/epub+zip',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename || 'book.epub';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    return {
        MAX_SIZE,
        parseEpubToBookContent,
        buildEpubFromBookContent,
        downloadBlob,
        safeName,
        ensureJSZip
    };
})();
