# 了了了读 · 了了了Read

> 探索未至之境 · 让阅读更轻

---

## 这是什么？

**了了了读** 是了了了岭工作室旗下的 **在线阅读器**：纯净、无广告、极简，打开网页就能读。

- 站内书库全部是 **JSON 数据**，按章按需加载，不依赖任何构建步骤或框架。
- **统一读书器** `reader.html`：上传 EPUB，浏览器现场解析成 JSON 立即阅读；站内任意书都能实时生成 EPUB / TXT / HTML / JSON 下载。
- 书签、高亮、批注、断点续读、字号与中文字体、多主题色、自定义背景、可拖拽且自动避让的悬浮工具箱，状态全部记在本机。
- 中英双语、深色模式、动态页脚、PWA 离线可用、移动端适配。
- 共创书库采用单页驱动：`data/community/reader.html?id=xxx` 读同目录 `books.json` 的 `dataUrl` 后渲染。

> 「零共用原则」：只借鉴兄弟站「了了了游」的架构思想，代码、数据、Supabase 后端、统计域名完全独立。

---

## 技术栈

- 前端：纯 HTML + CSS + 原生 JavaScript（零框架、零构建、零 npm 运行时依赖）
- 数据：`data/books.json` + 各书 `config.json` / `chapters/*.json`；旧 JS 数据已全部迁移为 JSON
- EPUB：根目录自托管 `jszip.min.js`（静态 UMD），`epub-bridge.js` 负责双向转换
- 作者总表：跨域只读 `https://authors.surge.sh/lelelereadauthor.json`（带超时降级）
- 后端（并行、独立）：见 [`docs/handoff/backend-supabase.md`](docs/handoff/backend-supabase.md)
- 部署：GitHub Pages + Cloudflare

---

## 目录速览

```
index.html              门户（胶囊分类 + 搜索 + 卡片网格）
reader.html             统一读书器（上传 EPUB / 内置书 / 导出下载）
author.html             作者公开主页
dashboard.html          作者后台
login.html / docs.html  登录 / 文档中心
common.css/js           全站基建（双语、主题、作者、Footer、PWA）
window.css/js           通用弹窗
reader.css/js           万能阅读器引擎
doc.css/js              长文排版与目录联动
other.css/js            杂项公共样式与状态组件
activity.json/css/js    活动主题与下雪特效
epub-bridge.css/js      EPUB ↔ JSON 双向转换
user-api.js / user-auth.js  独立账号与数据出入口（先本地模拟）
data/                   全部书籍 JSON + 共创书库
docs/api/               数据契约、EPUB 对齐说明
docs/handoff/           独立后端搭建指南（可直接复制给协助者）
datas-old/              只读归档：迁移前的旧数据，不发布
```

---

## 本地运行

纯静态，直接起一个本地服务器即可（避免 `file://` 的 fetch 限制）：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 访问地址

🌐 **[read.leleleling.site](https://read.leleleling.site)**

---

© 2026 了了了岭工作室 · 探索未至之境
