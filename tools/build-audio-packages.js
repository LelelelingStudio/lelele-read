#!/usr/bin/env node
/* 把新约戏剧化音频 mp3 拆成 27 个小包（每包含 manifest.json + index.html），
   并生成 data/bible/audio-index.json 供圣经页本地查表。

   为什么不用远程 manifest：surge 不返回 Access-Control-Allow-Origin，浏览器跨域
   fetch(manifest.json) 会被 CORS 拦截；<audio src> 跨域播放则无需 CORS。
   因此把「文件名 -> 完整 URL」的索引随仓库发布，运行时只查本地表。

   为什么用单级子域：surge 的通配符证书是 *.surge.sh，只覆盖一级子域；
   bibleaudio1.leleleread.surge.sh 这类二级子域会 ERR_CERT_COMMON_NAME_INVALID。

   用法：
     node tools/build-audio-packages.js [源目录]                 # 只生成/更新仓库内的 audio-index.json
     node tools/build-audio-packages.js [源目录] --build         # 额外在源目录生成 deploy/pkg1..27
     node tools/build-audio-packages.js [源目录] --build --domain-prefix=bibleaudio
   默认源目录：~/Downloads/English_World_English_Bible_NT_Drama
*/
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const positional = argv.filter(function (a) { return a.indexOf('--') !== 0; });
const src = positional[0] || path.join(os.homedir(), 'Downloads', 'English_World_English_Bible_NT_Drama');
const wantBuild = argv.indexOf('--build') !== -1;
const prefixOpt = argv.filter(function (a) { return a.indexOf('--domain-prefix=') === 0; })[0];
const prefix = prefixOpt ? prefixOpt.split('=').slice(1).join('=') : 'bibleaudio';

const PACKAGES = 27;
const BASE = 'https://' + prefix + '{p}.surge.sh/';
const OUT_DIR = path.join(src, 'deploy');

if (!fs.existsSync(src)) {
    console.error('源目录不存在:', src);
    process.exit(1);
}

/* 递归收集 mp3；deploy/ 是产物目录，跳过以免重复计入 */
function collect(dir, out) {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.name.charAt(0) === '.') continue;
        var p = path.join(dir, e.name);
        if (p === OUT_DIR) continue;
        if (e.isDirectory()) collect(p, out);
        else if (e.name.toLowerCase().slice(-4) === '.mp3') out.push(p);
    }
}
var paths = [];
collect(src, paths);
var byName = {};
paths.forEach(function (p) { var n = path.basename(p); if (!byName[n]) byName[n] = p; });
var names = Object.keys(byName).sort();
var total = names.length;
if (!total) { console.error('没有找到 mp3 文件:', src); process.exit(1); }

/* 均匀分配到 27 个包，每包 9~10 个，全部非空 */
var index = {
    version: 1,
    base: BASE,
    packages: PACKAGES,
    total: total,
    files: names.map(function (f, i) {
        return { f: f, p: Math.min(PACKAGES, Math.floor(i * PACKAGES / total) + 1) };
    })
};
fs.writeFileSync(path.join(ROOT, 'data', 'bible', 'audio-index.json'), JSON.stringify(index) + '\n');
console.log('索引已生成: data/bible/audio-index.json (' + total + ' files, ' + PACKAGES + ' packages, base=' + BASE + ')');

if (!wantBuild) {
    console.log('未加 --build，仅生成索引。');
    process.exit(0);
}

/* 生成 deploy/pkg1..27；同盘用硬链接，零额外磁盘占用、瞬间完成 */
var groups = {};
for (var g = 1; g <= PACKAGES; g++) groups[g] = [];
index.files.forEach(function (item) { groups[item.p].push(item); });

fs.mkdirSync(OUT_DIR, { recursive: true });
for (var p = 1; p <= PACKAGES; p++) {
    var d = path.join(OUT_DIR, 'pkg' + p);
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
    var list = [];
    groups[p].forEach(function (item) {
        var target = path.join(d, item.f);
        try { fs.linkSync(byName[item.f], target); }
        catch (err) { fs.copyFileSync(byName[item.f], target); }
        list.push(item.f);
    });
    list.sort();
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({
        base: BASE.replace('{p}', p),
        package: p,
        suffix: '_ENGWEBN2DA.mp3',
        files: list
    }) + '\n');
    fs.writeFileSync(path.join(d, 'index.html'),
        '<!doctype html><meta charset="utf-8"><title>Bible Audio ' + p + '</title>' +
        '<h1>lelele Read · Bible Audio · part ' + p + '</h1>' +
        '<p>' + list.length + ' tracks · <a href="manifest.json">manifest.json</a></p>\n');
    console.log('deploy/pkg' + p + ': ' + list.length + ' mp3 + manifest.json + index.html');
}
console.log('完成。部署目录:', OUT_DIR);
