# 了了了读 · 数据契约

> 本文件是「了了了读」所有模块唯一的字段依据。任何页面、脚本、迁移产物、EPUB 转换结果都必须符合这里的结构。
> 唯一数据源是 **JSON**。书籍数据目录不再有 `.js` 数据文件，也不再动态注入 `window.BOOK_DATA` 之类的全局变量。
> EPUB 只是导入/导出格式：上传时在浏览器内解析成 `BookContent`，下载时由 `BookContent` 实时生成，仓库里不预生成 EPUB 文件。

---

## 1. 书目记录 `BookRecord`

用于 `data/books.json`（数组）与 `data/community/books.json`（数组）。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | 稳定唯一标识，小写英文/数字/下划线，如 `bible`、`luxun`、`andys_book` |
| `title_zh` | string | ✅ | 中文书名 |
| `title_en` | string | ✅ | 英文书名 |
| `author` | number \| string | ✅ | 数字 = 跨域作者总表的 `id`；字符串 = 拼音（如 `luxun`）或展示名 |
| `cat` | string | ✅ | 分类键：`classic` / `religion` / `poetry` / `novel` / `essay` / `community` / `other` |
| `icon` | string | ✅ | 单个 emoji |
| `desc_zh` / `desc_en` | string | 推荐 | 一句话简介，卡片展示 |
| `cover` | string | 可选 | 封面图 URL |
| `format` | string | ✅ | 固定 `'json'`（站内唯一格式） |
| `configUrl` | string | 内置书 ✅ | 指向该书的 `config.json` |
| `dataUrl` | string | 共创书 ✅ | 外部 `BookContent` JSON 地址，需目标域允许 CORS |
| `downloadable` | boolean | 可选 | 默认 `true`，是否提供「在线生成 EPUB 下载」 |
| `sort` | number | 可选 | 门户排序权重，小的在前 |

示例：

```json
{
  "id": "bible",
  "title_zh": "圣经",
  "title_en": "Holy Bible",
  "author": 1,
  "cat": "religion",
  "icon": "📖",
  "desc_zh": "旧约与新约，共 66 卷",
  "desc_en": "Old and New Testament, 66 books",
  "format": "json",
  "configUrl": "/data/bible/config.json",
  "downloadable": true,
  "sort": 1
}
```

---

## 2. 书籍配置 `BookConfig`（`data/<book>/config.json`）

门户只加载书目总表；进入阅读页后才加载对应 `config.json`，再按章 `fetch` 章节 JSON。

```json
{
  "id": "bible",
  "title_zh": "圣经",
  "title_en": "Holy Bible",
  "format": "json",
  "groups": [
    { "title_zh": "旧约", "title_en": "Old Testament", "chapterIds": ["genesis", "exodus"] }
  ],
  "chapters": [
    { "id": "genesis", "title_zh": "创世记", "title_en": "Genesis", "file": "chapters/genesis.json", "group": "旧约" }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `groups` | 可选，分卷目录；`chapterIds` 指向 `chapters[].id` |
| `chapters[].file` | 相对 `config.json` 的路径，指向一个 `{id,title,chapters:[Chapter]}` 片段（同卷多章共用一个文件，按需加载一次后复用缓存） |
| `chapters[].index` | 该章在 `file` 所指文件 `chapters[]` 中的下标；阅读器只渲染这一章，避免大书一次性渲染上千章 |
| `chapters[].group` | 可选，对应 `groups[].id` |
| `Chapter.meta` | 可选，扩展元信息（如诗经的 `chapter` / `region` / `type`），渲染层忽略 |

---

## 3. 章节内容 `Chapter` / `BookContent`

`normalizeData(rawData, source?)` 的**唯一输出**结构，也是 EPUB 导入解析的输出、EPUB 导出的输入。

```json
{
  "id": "genesis",
  "title": "创世记",
  "chapters": [
    {
      "title": "第 1 章",
      "paragraphs": ["起初，神创造天地。", "地是空虚混沌……"],
      "html": null
    }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `BookContent.id` | string | 书 id |
| `BookContent.title` | string | 当前语言下的书名 |
| `BookContent.chapters` | Chapter[] | 章节数组，顺序即目录顺序 |
| `Chapter.title` | string | 章节标题 |
| `Chapter.paragraphs` | string[] | 纯文本段落；EPUB XHTML 清洗后按块级标签切分 |
| `Chapter.html` | string \| null | 可选，已清洗的安全 HTML 片段；有值时优先渲染，仍需过白名单 |

**归一化规则**：
- 站内 JSON：`config.json` 的章节文件直接是 `Chapter[]`，包一层 `BookContent`。
- 共创外部 JSON：允许直接是 `BookContent`，也允许是 `Chapter[]` 或 `paragraphs: string[]`（自动补章节标题）。
- EPUB 导入：解析结果必须是 `BookContent`，不得把 ZIP 内部路径/原始 XHTML 泄漏给渲染层。
- 旧的 `window.BOOK_DATA[...]` JS 全局对象**不再被运行时读取**，迁移时已一次性转成上述 JSON。

---

## 4. 共创书库 `data/community/books.json`

同 `BookRecord`，额外约定：

- `author` 为数字时，用 `window.AUTHORS_DATA`（来自 `https://authors.surge.sh/lelelereadauthor.json`）匹配 `name_zh` / `name_en`；匹配失败显示 `Unknown` / `未知作者`，不阻塞渲染。
- `author` 为拼音时，卡片可点作者名跳 `author.html?id=<拼音>`。
- 所有卡片统一跳 `data/community/reader.html?id=<id>`，由单页读 `books.json` 取 `dataUrl` 后渲染。
- `dataUrl` 请求带 8 秒超时、HTTP 状态校验、失败空态；不允许同步阻塞首屏。

---

## 5. EPUB ↔ JSON 映射

| 方向 | 输入 | 输出 | 实现位置 |
| --- | --- | --- | --- |
| EPUB → JSON | 本地 `.epub` File / 远程 URL | `BookContent`（可另存 `.json`） | `epub-bridge.js` → `parseEpubToBookContent()` |
| JSON → EPUB | `BookContent` | Blob（`application/epub+zip`） | `epub-bridge.js` → `buildEpubFromBookContent()` |

解析顺序：`META-INF/container.xml` → OPF(`rootfile`) → `manifest` / `spine` → EPUB3 `nav.xhtml`，回退 EPUB2 `toc.ncx` → 按 spine 顺序解压章节 XHTML → 白名单清洗 → `Chapter.paragraphs`。

生成顺序：`mimetype`（store 不压缩，必须为 ZIP 第一个条目）→ `META-INF/container.xml` → `OEBPS/content.opf` → `OEBPS/toc.ncx` + `nav.xhtml` → `OEBPS/chapter-N.xhtml` → `OEBPS/style.css` → `generateAsync({type:'blob'})` → `<a download>`。

清洗规则：只保留 `p / h1-h6 / div / span / em / strong / br / blockquote / ul / ol / li / img / a / section / article`；剔除 `script / style / iframe / object`、所有 `on*` 事件属性、`javascript:` 协议；图片与 CSS 相对路径重写为 blob URL；用户批注统一走 `escapeHtml`。

能力边界与支持范围详见 `docs/api/epub-conversion.md`。

---

## 6. 本地存储与事件

| 项 | 约定 |
| --- | --- |
| 键前缀 | 统一 `lelele_read_`，与「游」站 `lelele_*` 隔离 |
| 语言 / 主题 | `lelele_read_lang` / `lelele_read_theme` |
| 阅读状态 | `lelele_read_progress_<bookId>`、`lelele_read_notes_<bookId>`、`lelele_read_layout_<bookId>` |
| 事件 | `langChanged`、`themeChanged`、`authorsLoaded`（`common.js` 已有，保持签名） |
| 全局工具 | `window.getLang()`、`window.setLang()`、`window.showToast()`、`window.escapeHtml()`、`window.leleleTrack()`、`window.AUTHORS_DATA`、`window.Reader`、`window.UserAPI` |

---

## 7. 独立性检查

- 不引用 `game.leleleling.site` 的任何文件、接口、Supabase 项目或统计域名。
- 不引入构建步骤、框架、CDN 运行时依赖；第三方库以静态 UMD 文件自托管在站点根目录。
- 新增公共文件保持 `.css` / `.js` 成对，公共资源直接放根目录，不建 `assets/` 或 `shared/`。
