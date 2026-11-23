#!/usr/bin/env node
/* =========================================================
   import-readthingadd.js
   把 readthingadd 里两份干净的数据集转成"了了了读"内置书格式：
     - chinese-ancient-text-master : 62 部古籍 -> 62 本书
     - modern-poetry-master        : 157 部诗集 -> 按语种/时期 9 本书
   输出 data/guji/<id>/config.json + chapters/all.json，并登记到 data/books.json。
   幂等：重复运行会覆盖生成物、不会重复追加 books.json 条目。
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'readthingadd');
const DATA = path.join(ROOT, 'data');
const BOOKS_JSON = path.join(DATA, 'books.json');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJson(file, obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
}
function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : [p];
    });
}
function clean(s) {
    return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
}
// 书名 -> 拼音 id（无依赖，仅用于稳定文件名）；非中文/数字原样保留
function slug(name, seed) {
    const map = {
        '史记':'shiji','汉书':'hanshu','后汉书':'houhanshu','三国志':'sanguozhi','资治通鉴':'zizhitongjian',
        '诗经':'shijing','尚书':'shangshu','礼记':'liji','周易':'zhouyi','春秋':'chunqiu','论语':'lunyu',
        '孟子':'mengzi','老子':'laozi','道德经':'daodejing','庄子':'zhuangzi','列子':'liezi','荀子':'xunzi',
        '韩非子':'hanfeizi','墨子':'mozi','孙子兵法':'sunzibingfa','吴子':'wuzi','尉缭子':'weiliaozi',
        '三略':'sanlve','六韬':'liutao','司马法':'simafa','尉缭':'weiliao','黄帝内经':'huangdineijing',
        '伤寒论':'shanghanlun','金匮要略':'jinkuiyaolue','神农本草经':'shennongbencaojing','本草纲目':'bencaogangmu',
        '山海经':'shanhaijing','水经注':'shuijingzhu','徐霞客游记':'xuxiakeyouji','世说新语':'shishuoxinyu',
        '古文观止':'guwenguanzhi','文心雕龙':'wenxindiaolong','楚辞':'chuci','乐府诗集':'yuefushiji',
        '全唐诗':'quantangshi','全宋词':'quansongci','资治通鉴':'zizhitongjian','了凡四训':'liaofanxun',
        '菜根谭':'caigentan','围炉夜话':'weiluyeyehua','小窗幽记':'xiaochuangyouji','菜根谭':'caigentan',
        '大学':'daxue','中庸':'zhongyong','孝经':'xiaojing','尔雅':'erya','说文解字':'shuowenj iezi',
        '百家姓':'baijiaxing','三字经':'sanzijing','千字文':'qianziwen','增广贤文':'zengguangxianwen',
        '冰鉴':'bingjian','反经':'fanjing','人物志':'renwuzhi','长短经':'changduanjing','鬼谷子':'guiguzi',
        '公孙龙子':'gongsunlongzi','邓析子':'dengxizi','尹文子':'yinwenzi','慎子':'shenzi','申子':'shenzi',
        '商君书':'shangjunshu','管子':'guanzi','晏子春秋':'yanzichunqiu','吴越春秋':'wuyuechunqiu',
        '越绝书':'yuejueshu','华阳国志':'huayangguozhi','洛阳伽蓝记':'luoyangqielanji','贞观政要':'zhenguan Zhengyao',
        '通典':'tongdian','文献通考':'wenxiantongkao','史通':'shitong','文史通义':'wenshitongyi',
        '困学纪闻':'kunxuejiwen','日知录':'rizhilu','廿二史札记':'nianershizhaji','十驾斋养新录':'shijiazhai',
        '四库全书总目':'sikuquanshuzongmu','四库提要':'sikutiyao','书目答问':'shumudawen','校雠通义':'xiaochoutongyi',
        '周易正义':'zhouyizhengyi','尚书正义':'shangshuzhengyi','毛诗正义':'maoshizhengyi','礼记正义':'liji zhengyi',
        '春秋左传':'chunqiuzuozhuan','春秋公羊传':'chunqiugongyangzhuan','春秋谷梁传':'chunqiuguliangzhuan',
        '仪礼':'yili','周礼':'zhouli','大戴礼记':'dadailiji','孔子家语':'kongzijiayu','孔子集语':'kongzijiyu'
    };
    if (map[name]) return map[name];
    let out = '', tail = 0;
    for (const ch of String(name)) {
        const cp = ch.codePointAt(0);
        if (cp > 0x2e80) { out += 'g' + cp.toString(16); }
        else if (/[a-z0-9_-]/i.test(ch)) { out += ch.toLowerCase(); }
        else if (!out.endsWith('-')) { out += '-'; }
        if (out.length > 48) break;
    }
    return (out.replace(/^-+|-+$/g, '') || 'guji-' + seed).slice(0, 56);
}

const added = [];
function addBook(entry) {
    const i = added.findIndex(b => b.id === entry.id);
    if (i >= 0) added[i] = entry;
    else added.push(entry);
}

/* ---------- 1. 62 部古籍 ---------- */
// 经史子集粗分：宁可归入最多的一类，也不新增过多按钮
const JING = ['周易','尚书','诗经','周礼','仪礼','礼记','大学','中庸','论语','孟子','孝经','尔雅','说文','春秋','公羊','谷梁','左传'];
const SHI = ['史记','汉书','后汉书','三国志','资治通鉴','战国策','国语','越绝','吴越','华阳','水经','徐霞客','贞观','通典','文献通考','史通','文史通义','廿二史','日知录','困学纪闻','四库','书目','校雠'];
const ZI  = ['老子','道德经','庄子','列子','荀子','韩非','墨子','孙子','吴子','六韬','三略','司马法','鬼谷','公孙龙','邓析','尹文','慎子','申子','商君','管子','晏子','吕氏','淮南','论衡','抱朴','世说','菜根','围炉','小窗','了凡','冰鉴','反经','人物志','伤寒','金匮','本草','内经','神农','三十六计','百战','尉缭','三字经','千字文','百家姓','增广','成语','楹联','对联','家训','格言'];
function gujiCat(name) {
    if (SHI.some(k => name.indexOf(k) !== -1)) return 'history';
    if (JING.some(k => name.indexOf(k) !== -1)) return 'jing';
    if (ZI.some(k => name.indexOf(k) !== -1)) return 'zi';
    return 'classics-lit';
}

function convertGuji() {
    const dir = path.join(SRC, 'chinese-ancient-text-master');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'zh'));
    let made = 0;
    files.forEach((file, idx) => {
        let j;
        try { j = readJson(path.join(dir, file)); } catch (e) { return; }
        if (!j || typeof j.name !== 'string' || !Array.isArray(j.articles)) return;
        const name = clean(j.name) || path.basename(file, '.json');
        const desc = clean(j.description).replace(/是由撰写的/, '是由'); // 修源数据缺字的明显笔误
        const id = 'guji-' + slug(name, idx);
        const chapters = j.articles.map(a => ({
            title: clean(a.title) || '章节',
            paragraphs: Array.isArray(a.content) ? a.content.map(clean).filter(Boolean) : [clean(a.content)].filter(Boolean)
        })).filter(c => c.paragraphs.length);
        if (!chapters.length) return;

        const bookDir = path.join(DATA, 'guji', id);
        writeJson(path.join(bookDir, 'chapters', 'all.json'), { id, title: name, chapters });
        writeJson(path.join(bookDir, 'config.json'), {
            id, title_zh: name, title_en: name, format: 'json',
            chapters: chapters.map((c, i) => ({
                id: id + '-' + (i + 1), title_zh: c.title, title_en: 'Part ' + (i + 1),
                file: 'chapters/all.json', index: i
            }))
        });
        addBook({
            id, title_zh: name, title_en: name, author: '佚名', cat: gujiCat(name), icon: '📜',
            desc_zh: desc.slice(0, 90) || ('《' + name + '》全文，共 ' + chapters.length + ' 篇。'),
            desc_en: desc.slice(0, 90) || (name + ', ' + chapters.length + ' sections. Text in Chinese.'),
            format: 'json', configUrl: '/data/guji/' + id + '/config.json',
            downloadable: true, sort: 100 + idx
        });
        made++;
    });
    console.log('古籍转换:', made, '部');
}

/* ---------- 2. 现代诗 ---------- */
const POETRY_GROUPS = [
    { dir: 'China-modern-poetry/modern', id: 'modern-cn', title_zh: '中国现代诗', title_en: 'Chinese Modern Poetry' },
    { dir: 'China-modern-poetry/modern times', id: 'modern-times', title_zh: '中国近代诗', title_en: 'Chinese Poetry of Modern Times' },
    { dir: 'China-modern-poetry/contemporary', id: 'contemporary-cn', title_zh: '中国当代诗', title_en: 'Chinese Contemporary Poetry' },
    { dir: 'France-poetry', id: 'france', title_zh: '法国诗歌', title_en: 'French Poetry' },
    { dir: 'Germany-poetry', id: 'germany', title_zh: '德国诗歌', title_en: 'German Poetry' },
    { dir: 'UK-poetry', id: 'uk', title_zh: '英国诗歌', title_en: 'English Poetry' },
    { dir: 'USA-poetry', id: 'usa', title_zh: '美国诗歌', title_en: 'American Poetry' },
    { dir: 'Russia-poetry', id: 'russia', title_zh: '俄国诗歌', title_en: 'Russian Poetry' },
    { dir: 'others', id: 'others', title_zh: '其他语种诗歌', title_en: 'Poetry in Other Languages' }
];
function convertPoetry() {
    const base = path.join(SRC, 'modern-poetry-master');
    POETRY_GROUPS.forEach((g, gi) => {
        const dir = path.join(base, g.dir);
        if (!fs.existsSync(dir)) return;
        const files = walk(dir).filter(f => f.endsWith('.json') && path.basename(f) !== 'author.json').sort();
        const chapters = [], glist = [];
        let seed = 0;
        files.forEach(f => {
            let arr;
            try { arr = readJson(f); } catch (e) { return; }
            if (!Array.isArray(arr)) return;
            arr.forEach(p => {
                if (!p || typeof p !== 'object' || !p.title) return;
                const paras = Array.isArray(p.paragraphs) ? p.paragraphs : [p.paragraphs];
                const content = paras.map(clean).filter(Boolean);
                if (!content.length) return;
                const author = clean(p.author) || path.basename(f, '.json');
                chapters.push({ title: clean(p.title) + ' · ' + author, author, paragraphs: content });
            });
        });
        if (!chapters.length) return;
        // 按作者切分，每本 <= 1200 首：避免单本 config 数 MB、目录渲染几万项卡死
        const LIMIT = 1200;
        const byAuthor = new Map();
        chapters.forEach(c => {
            if (!byAuthor.has(c.author)) byAuthor.set(c.author, []);
            byAuthor.get(c.author).push(c);
        });
        const volumes = [];
        let bucket = [], bucketAuthors = [];
        for (const [author, list] of byAuthor) {
            if (bucket.length && bucket.length + list.length > LIMIT) {
                volumes.push({ list: bucket, authors: bucketAuthors, label: bucketAuthors[0] + ' 等' });
                bucket = []; bucketAuthors = [];
            }
            if (list.length > LIMIT) {
                for (let k = 0; k < list.length; k += LIMIT) {
                    const part = list.slice(k, k + LIMIT);
                    volumes.push({ list: part, authors: [author], label: author + ' ' + (k / LIMIT + 1) });
                }
            } else {
                bucket = bucket.concat(list);
                bucketAuthors.push(author);
            }
        }
        if (bucket.length) volumes.push({ list: bucket, authors: bucketAuthors, label: bucketAuthors[0] + ' 等' });

        volumes.forEach((vol, vi) => {
            const suffix = volumes.length === 1 ? '' : '-' + (vi + 1);
            const id = 'poetry-' + g.id + suffix;
            const title = volumes.length === 1 ? g.title_zh : g.title_zh + ' · ' + vol.label;
            const titleEn = volumes.length === 1 ? g.title_en : g.title_en + ' · Vol. ' + (vi + 1);
            const bookDir = path.join(DATA, 'poetry', id);
            writeJson(path.join(bookDir, 'chapters', 'all.json'), {
                id, title, chapters: vol.list.map(c => ({ title: c.title, paragraphs: c.paragraphs }))
            });
            writeJson(path.join(bookDir, 'config.json'), {
                id, title_zh: title, title_en: titleEn, format: 'json',
                chapters: vol.list.map((c, i) => ({
                    id: id + '-' + (i + 1), title_zh: c.title, title_en: 'Poem ' + (i + 1),
                    file: 'chapters/all.json', index: i
                }))
            });
            addBook({
                id, title_zh: title, title_en: titleEn, author: '佚名',
                cat: g.dir.indexOf('China-') === 0 ? 'poetry-cn' : 'poetry-world', icon: '🖋️',
                desc_zh: '收录 ' + vol.list.length + ' 首诗，来自 ' + vol.authors.length + ' 位作者。',
                desc_en: vol.list.length + ' poems by ' + vol.authors.length + ' authors. Text in original language.',
                format: 'json', configUrl: '/data/poetry/' + id + '/config.json',
                downloadable: true, sort: 200 + gi + vi / 1000
            });
        });
        console.log('诗集转换:', g.title_zh, chapters.length, '首 ->', volumes.length, '本');
    });
}

/* ---------- 3. 登记 books.json ---------- */
function register() {
    const books = readJson(BOOKS_JSON);
    // 幂等：先剔除本脚本管理的全部旧条目（含拆分前遗留的单卷 id），再写入本次结果。
    const managed = b => (b.id && (b.id.indexOf('guji-') === 0 || b.id.indexOf('poetry-') === 0));
    const kept = books.filter(b => !managed(b));
    fs.writeFileSync(BOOKS_JSON, JSON.stringify(kept.concat(added), null, 2) + '\n', 'utf8');
    console.log('books.json 条目:', books.length, '->', kept.length + added.length);
}

convertGuji();
convertPoetry();
register();
console.log('完成。新增', added.length, '本书。');
