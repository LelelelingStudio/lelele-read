# EPUB ↔ JSON 对齐说明

> 这份文档是给用户确认「EPUB 方案」的对齐材料。实现落在 `epub-bridge.js` / `reader.js` / `reader.html`，字段契约见 `data-contract.md`。

## 1. 用户要的是什么（已确认的方向）

- 「增加一个读书器，支持上传 EPUB，然后我们线上解析成 JSON，然后我们的书可以下载 EPUB」
- 「JS 不能有了，得都变成 JSON」
- 「如果 JSON 转 EPUB 不复杂，就可以在 HTML 里写了，到时候用户可以下载」
- **不采用下下策**：不在仓库里为每本书预先生成一份 JSON + 一份 EPUB，不维护两份数据。

## 2. 落地结论

| 项 | 做法 |
| --- | --- |
| 唯一数据源 | JSON。站内书 = `config.json` + `chapters/*.json`；共创书 = 外部 JSON；导入书 = 浏览器内存中的 `BookContent` |
| 旧 JS 数据 | 全部一次性转成 JSON，`data/` 下不再有 `.js` 数据文件，运行时不再动态注入 `window.BOOK_DATA` |
| 导入 | 本地 `.epub` / `.json` 上传 → 浏览器内用同域 `jszip.min.js` 解压解析 → `BookContent` → `reader.js` 的 `normalizeData()` → 立即阅读 |
| 导出 | `BookContent` → 浏览器内实时打包 EPUB 容器 → `Blob` → `<a download>`。仓库里**没有任何预生成 .epub 文件** |
| 其它导出 | TXT / HTML / JSON，全部前端实时生成 |

## 3. EPUB → JSON 解析流程

1. `JSZip.loadAsync(ArrayBuffer)`，检查 `META-INF/encryption.xml`（存在即拒绝，不支持 DRM）。
2. `META-INF/container.xml` → `rootfile@full-path` 定位 OPF。
3. OPF：`metadata`（书名/作者/语言）、`manifest`（id→href/type/properties）、`spine`（章节顺序）。
4. 目录：EPUB3 优先读带 `properties="nav"` 的 `nav.xhtml`，回退 EPUB2 `toc.ncx`，生成 `路径 → 章节标题` 映射。
5. 按 spine 顺序逐章解压 XHTML（**单章处理，不整本展开**），清洗后产出：
   - `paragraphs`：从 `p / h1-h6 / blockquote / li / pre` 提取的纯文本段落；
   - `html`：清洗后的安全 HTML 片段（保留图片，相对路径改写为 blob URL）。
6. 输出 `{id, title, chapters:[{title, paragraphs, html}], meta}`，与站内 JSON 完全同构，直接进统一阅读器。

**清洗白名单**：`p/h1-h6/div/span/em/strong/b/i/br/blockquote/ul/ol/li/img/a/section/article/pre/hr/table/tr/td/th`；移除 `script/style/iframe/object/link/meta/base`、所有 `on*` 事件属性、`javascript:` / `data:` 协议、含 `url()` 的内联样式；外链图片保留，站内图片转 blob URL（单本上限 80 张，避免爆内存）。

## 4. JSON → EPUB 生成流程

`buildEpubFromBookContent(book)` 在浏览器内生成一个合法 EPUB3（兼容 EPUB2 阅读器）：

```
mimetype                      (STORE 不压缩，必须是 ZIP 第一个条目)
META-INF/container.xml
OEBPS/content.opf             (dc:title / dc:creator / dc:language / manifest / spine)
OEBPS/toc.ncx                 (EPUB2 目录)
OEBPS/nav.xhtml               (EPUB3 目录，properties="nav")
OEBPS/style.css
OEBPS/chapter-1.xhtml ... N   (每章一个 XHTML，段落转义后写入 <p>)
```

生成后 `zip.generateAsync({type:'blob', mimeType:'application/epub+zip'})` → `downloadBlob()` 下载。全程无服务端、无构建步骤、无落盘文件。

导出前若章节是懒加载（内置书），`reader.js` 会先按批加载全部章节并显示进度；大书（如圣经 1189 章）可能需要几秒。

## 5. 支持边界

| 能力 | 支持 |
| --- | --- |
| EPUB 2 / EPUB 3 非加密、流式排版 | ✅ |
| 本地上传 `.epub`（≤ 20MB） | ✅ |
| 本地上传 `.json`（符合 `BookContent`） | ✅ |
| 站内任意书导出 EPUB / TXT / HTML / JSON | ✅ |
| 导入后复用书签、高亮、批注、断点续读、字号字体、主题色、自定义背景、拖拽工具箱 | ✅ |
| 远程 `dataUrl` 的 EPUB | ⚠️ 需目标域允许 CORS；首期以本地上传为主 |
| 封面提取 | ⚠️ 可选增强，首期不展示 |
| DRM / 加密字体 | ❌ |
| 固定版式（pre-paginated）、内嵌脚本交互 | ❌ |
| MathML、复杂 SVG 完整渲染 | ❌ |
| 导出回写覆盖原 EPUB | ❌（导出的是全新生成的 EPUB） |

## 6. 为什么不用 epub.js

`epub.js` 用 iframe rendition 自成一派渲染与主题体系，和现有 `reader.js` 的段落级书签/高亮批注锚点、可拖拽悬浮工具箱、多主题色与自定义背景冲突，等于维护两套渲染。JSZip + 自写 OPF 解析让导入结果**直接是统一 JSON**，导入和导出共用一套数据契约，长期成本更低，也更符合「零构建、纯静态」。

## 7. 验收用例

1. 打开 `/reader.html`，拖入一本非加密 EPUB → 出现解析进度 → 目录与正文正常显示 → 刷新后可断点续读。
2. 同一本书点「导出 EPUB」→ 得到 `.epub` 文件 → 用任意阅读器打开，目录与章节顺序正确。
3. 打开 `/reader.html?book=bible` → 1189 章目录可跳转 → 导出 TXT / HTML / JSON 内容完整。
4. 上传一个符合契约的 `.json` → 立即阅读，导出 EPUB 正常。
5. 上传 25MB 文件 / 加密 EPUB / 普通 PDF → 给出友好中文错误，不白屏、不卡死。
6. 断网时站内 JSON 书籍仍可读，只有导入 EPUB（若 JSZip 未缓存）会提示组件加载失败。

---

© 2026 了了了岭工作室 · 了了了读
