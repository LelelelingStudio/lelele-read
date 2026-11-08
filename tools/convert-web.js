/* 一次性转换：eng-web_readaloud 的英文 WEB 逐章 txt → data/bible/web/*.json
   结构严格对齐现有 data/bible/chapters/XX.json：
   { id:'web-N', title:'创世记', chapters:[ { title:'Chapter N', paragraphs:[ 逐节 ] } ] }
   书卷以文件名的 CODE 缩写映射到 01–66（WEB 的 NNN 内部序号不可信）。
   每文件跳过前 2 行（书卷全名 / "Chapter N."），剩余非空行 = 逐节经文。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'eng-web_readaloud');
const OUT = path.join(ROOT, 'data', 'bible', 'web');
const CN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bible', 'books.json'), 'utf8'));

const CODE2ORDER = {
  GEN: 1, EXO: 2, LEV: 3, NUM: 4, DEU: 5, JOS: 6, JDG: 7, RUT: 8,
  '1SA': 9, '2SA': 10, '1KI': 11, '2KI': 12, '1CH': 13, '2CH': 14, EZR: 15, NEH: 16, EST: 17,
  JOB: 18, PSA: 19, PRO: 20, ECC: 21, SON: 22, SNG: 22, ISA: 23, JER: 24, LAM: 25, EZK: 26, DAN: 27,
  HOS: 28, JOL: 29, AMO: 30, OBA: 31, JON: 32, MIC: 33, NAH: 34, NAM: 34, HAB: 35, ZEP: 36, HAG: 37, ZEC: 38, MAL: 39,
  MAT: 40, MRK: 41, LUK: 42, JHN: 43, ACT: 44, ROM: 45, '1CO': 46, '2CO': 47, GAL: 48, EPH: 49, PHP: 50, COL: 51,
  '1TH': 52, '2TH': 53, '1TI': 54, '2TI': 55, TIT: 56, PHM: 57, HEB: 58, JAS: 59, '1PE': 60, '2PE': 61,
  '1JN': 62, '2JN': 63, '3JN': 64, JUD: 65, REV: 66
};
// WEB 资源包内含次经/旁经（托比特、犹滴、所罗门智训、巴录、马加比 1-4、以斯拉续、玛拿西祷文、诗篇续、但以理希腊文补篇等），
// 这些不在新教 66 卷正典内，转换时跳过且不在控制台刷噪声。
const APOCYPHA = { TOB: 1, JDT: 1, ESG: 1, WIS: 1, SIR: 1, BAR: 1, '1MA': 1, '2MA': 1, '1ES': 1, MAN: 1, PS2: 1, '3MA': 1, '2ES': 1, '4MA': 1, DAG: 1 };

const ORDER2EN = {
  1: 'genesis', 2: 'exodus', 3: 'leviticus', 4: 'numbers', 5: 'deuteronomy', 6: 'joshua', 7: 'judges', 8: 'ruth',
  9: '1_samuel', 10: '2_samuel', 11: '1_kings', 12: '2_kings', 13: '1_chronicles', 14: '2_chronicles', 15: 'ezra', 16: 'nehemiah', 17: 'esther',
  18: 'job', 19: 'psalms', 20: 'proverbs', 21: 'ecclesiastes', 22: 'song_of_solomon', 23: 'isaiah', 24: 'jeremiah', 25: 'lamentations', 26: 'ezekiel', 27: 'daniel',
  28: 'hosea', 29: 'joel', 30: 'amos', 31: 'obadiah', 32: 'jonah', 33: 'micah', 34: 'nahum', 35: 'habakkuk', 36: 'zephaniah', 37: 'haggai', 38: 'zechariah', 39: 'malachi',
  40: 'matthew', 41: 'mark', 42: 'luke', 43: 'john', 44: 'acts', 45: 'romans', 46: '1_corinthians', 47: '2_corinthians', 48: 'galatians', 49: 'ephesians', 50: 'philippians', 51: 'colossians',
  52: '1_thessalonians', 53: '2_thessalonians', 54: '1_timothy', 55: '2_timothy', 56: 'titus', 57: 'philemon', 58: 'hebrews', 59: 'james', 60: '1_peter', 61: '2_peter', 62: '1_john', 63: '2_john', 64: '3_john', 65: 'jude', 66: 'revelation'
};

fs.mkdirSync(OUT, { recursive: true });

const books = {}; // order -> { chapters: [] }
let used = 0, skipped = 0;
const files = fs.readdirSync(SRC).filter(f => /^eng-web_\d+_[A-Z0-9]+_\d+_read\.txt$/.test(f));
for (const f of files) {
  const m = f.match(/^eng-web_\d+_([A-Z0-9]+)_(\d+)_read\.txt$/);
  const code = m[1];
  const ch = parseInt(m[2], 10);
  const order = CODE2ORDER[code];
  if (!order) { if (!APOCYPHA[code]) console.warn('skip (unknown code):', code, f); skipped++; continue; }
  const lines = fs.readFileSync(path.join(SRC, f), 'utf8').split(/\r?\n/);
  const verseLines = lines.slice(2).map(s => s.trim()).filter(s => s.length);
  if (!books[order]) books[order] = { chapters: [] };
  books[order].chapters[ch - 1] = { title: 'Chapter ' + ch, paragraphs: verseLines };
  used++;
}

let missing = 0;
for (let order = 1; order <= 66; order++) {
  const b = books[order];
  if (!b) { console.error('MISSING book order', order); missing++; continue; }
  const en = ORDER2EN[order];
  const cn = CN.find(c => c.order === order) || {};
  const data = {
    id: 'web-' + order,
    title: cn.title_zh || en,
    chapters: b.chapters
  };
  fs.writeFileSync(path.join(OUT, 'web-' + String(order).padStart(2, '0') + '_' + en + '.json'), JSON.stringify(data, null, 2) + '\n');
}

// web-books.json：复用中文书名/分组/章数，补充英文缩写与署名
const cnMap = {};
CN.forEach(c => { cnMap[c.order] = c; });
const meta = [];
for (let order = 1; order <= 66; order++) {
  const c = cnMap[order];
  const en = ORDER2EN[order];
  const file = 'web-' + String(order).padStart(2, '0') + '_' + en + '.json';
  const data = JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8'));
  const generated = data.chapters.length;
  if (c && c.chapterCount && c.chapterCount !== generated) {
    console.warn('chapter count mismatch order', order, 'cn', c.chapterCount, 'web', generated);
  }
  meta.push({
    order: order,
    file: file,
    title_zh: c ? c.title_zh : en,
    title_en: en.replace(/_/g, ' '),
    testament: c ? c.testament : (order <= 39 ? 'old' : 'new'),
    chapterCount: generated
  });
}
const metaObj = {
  translation: 'web',
  name_zh: '英文标准译本',
  name_en: 'World English Bible',
  public_domain: true,
  source: 'eBible.org',
  source_url: 'https://ebible.org/eng-web',
  license_note: 'The World English Bible is in the Public Domain. "World English Bible" is a trademark of eBible.org.',
  books: meta
};
fs.writeFileSync(path.join(ROOT, 'data', 'bible', 'web-books.json'), JSON.stringify(metaObj, null, 2) + '\n');

console.log('used', used, 'files; skipped', skipped, '; missing', missing, '; web json', Object.keys(books).length, '; meta books', meta.length);
