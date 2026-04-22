---
description: 全自动文献调研：下载真实论文 PDF 并 OCR，再执行搜索和 gap 分析
---

> **必须使用 AskUserQuestion 工具进行所有确认步骤，不得用纯文字替代。**

你是 Oh My Paper Orchestrator。执行文献调研前先和用户对齐方向，然后下载真实论文 PDF 并 OCR，让 ideation 阶段能读到真实论文内容。

## 第一步：读取研究主题

```bash
cat .pipeline/memory/project_truth.md
cat .pipeline/docs/research_brief.json
cat .pipeline/memory/literature_bank.md  # 查看已有多少文献
```

## 第二步：展示搜索计划，等待确认

用 `AskUserQuestion` 展示：

> 准备搜索以下方向的文献：
> 1. [方向 A]（关键词：...）
> 2. [方向 B]（关键词：...）
> 3. [方向 C]（关键词：...）
>
> 目标：约 20-30 篇，已有 X 篇
> **工具：** literature-pdf-ocr-library（真实 PDF + OCR）+ inno-deep-research

选项：
- `确认，关键词搜索`
- `调整搜索方向`
- `只搜某个方向`
- `我有具体的 arXiv ID 列表，直接下载`
- `按会议+年拉完整 accepted list（venue 模式）`

如果用户选择调整，`AskUserQuestion` 询问具体方向修改，更新后再确认一次。
如果用户提供了 arXiv ID 列表，直接进入第四步用 `--arxiv-ids` 模式。
如果用户选择 venue 模式，进入"第二步补：venue 模式确认"。

### 第二步补：venue 模式确认（仅 venue 模式）

用 `AskUserQuestion` 询问：

> 准备拉哪些会议+年？支持 slug：
> `isca-YYYY micro-YYYY hpca-YYYY asplos-YYYY mlsys-YYYY dac-YYYY iccad-YYYY`
> （例：`asplos-2024 isca-2024 hpca-2024`）

选项（多选）：
- `体系结构四大 2024（asplos-2024 isca-2024 micro-2024 hpca-2024）`
- `EDA 两大 2024（dac-2024 iccad-2024）`
- `MLSys 2024（mlsys-2024）`
- `让我自己指定 slug 列表`

Venue 模式流水线：**DBLP 精确枚举 → OpenAlex 摘要回填 → topic 关键词预过滤 → 三桶分发（arxiv / acm / ieee）**。
- arxiv 桶：脚本自动下载
- ACM 桶：ACM DL 被 Cloudflare 拦住 curl，需要用 web-access skill 驱动真 Chrome 过 CDP + 本地 HTTP PUT 接收器（见第四步 4a-acm）
- IEEE 桶：Xplore 非 OA，需要用户登录学校 IEEE 账号，由 Claude 先写 `ieee_review.md` 做相关度判断，再批量下载（见第四步 4a-ieee）

参考：skill 内 `references/venue-mode.md` 有完整细节，遇到异常时先读那份。

## 第三步：询问 OCR 方式（下载前必须确认）

用 `AskUserQuestion` 询问：

> 下载 PDF 后需要 OCR 转 Markdown，供后续 ideation 阅读真实论文内容。请选择 OCR 方式：

选项：
- `使用 PaddleOCR API（高质量布局识别，需要 Token）`
- `使用 pdfminer 本地模式（纯文本，无需 Token）`
- `只下载 PDF，暂不 OCR`

**如果用户选择 PaddleOCR API：**
用 `AskUserQuestion` 继续询问：
> 请提供你的 PADDLEOCR_TOKEN（仅用于本次会话，不会写入任何文件）：

**如果用户选择 pdfminer：**
用 `AskUserQuestion` 再次确认：
> pdfminer 只提取纯文本，没有图表和公式布局识别。确认用 pdfminer 继续？

选项：
- `确认，用 pdfminer 继续`
- `等我找到 PaddleOCR Token 再说`

## 第四步：执行下载 + OCR（仅在确认后）

### 4a. 下载论文

corpus-name 根据研究主题自动命名（短横线格式，如 `humanoid-locomotion`）。**skill 被加载后，脚本路径由 Claude Code 自动解析为 plugin 内路径（`${CLAUDE_PLUGIN_ROOT}/skills/literature-pdf-ocr-library/scripts/`），下面示例用相对写法只是为了可读**。

```bash
# 关键词搜索模式
python .claude/skills/literature-pdf-ocr-library/scripts/search_and_download_papers.py \
  --query "<搜索关键词>" \
  --out-dir .pipeline/literature/<corpus-name> \
  --limit 20 --sources arxiv semanticscholar openalex \
  --download-pdfs

# arXiv IDs 模式
python .claude/skills/literature-pdf-ocr-library/scripts/search_and_download_papers.py \
  --arxiv-ids <id1> <id2> ... \
  --out-dir .pipeline/literature/<corpus-name> \
  --download-pdfs

# venue 模式（DBLP 枚举 + 三桶分发）
python .claude/skills/literature-pdf-ocr-library/scripts/search_and_download_papers.py \
  --venues <slug1> <slug2> ... \
  --out-dir .pipeline/literature/<corpus-name> \
  --download-pdfs
# venue 模式脚本只自动下 arxiv 桶；ACM / IEEE 桶需跑下面的子流程。
# --no-topic-filter 留全部；--no-download 只生成 queue 和 manifest 不下载。
```

#### 4a-acm. ACM 桶批下载（venue 模式产物：`acm_download_queue.json` 非空时）

前置：web-access skill 的 Chrome CDP proxy 已就绪（见 `web-access/scripts/check-deps.mjs`）。用户 Chrome 能正常访问 `https://dl.acm.org/`（ACM DL 对机构 IP 或 Open Access 都开放，无需登录）。

```bash
# 1. 本地 HTTP PUT 接收器（绕开 CDP eval 返回值大小限制）
python .claude/skills/literature-pdf-ocr-library/scripts/pdf_recv.py \
  .pipeline/literature/<corpus-name>/acm_download_queue.json 9876 &

# 2. 批量下载（单 Chrome tab 复用）
python .claude/skills/literature-pdf-ocr-library/scripts/download_acm_batch.py \
  .pipeline/literature/<corpus-name>/acm_download_queue.json

# 完成后 kill 接收器
```

#### 4a-ieee. IEEE 桶批下载（venue 模式产物：`ieee_manifest.md` 非空时）

前置：用户在日常 Chrome 里登录学校 IEEE Xplore（OpenAthens / IP / VPN 任一种都行），一次手点任意一篇 PDF 验证登录生效。

**先让 Claude 自己做相关度判断**，不要让用户逐条确认：
1. 读 `ieee_manifest.md` 的每个 title + 对应 `papers/<slug>/metadata.json` 里 OpenAlex 回填的 abstract。
2. 按 HIGH / MED-H / MED / LOW 四档打分，LOW 的跳过。
3. 写 `ieee_review.md`（每篇一段：title / DOI / kw / 一句 what-it-does / 相关度判定 + 一句 why / DOWNLOAD 或 SKIP）。
4. 把 DOWNLOAD 的挑出来，生成 `ieee_download_queue.json`（schema 同 acm_download_queue.json：`paper_slug / doi / target_path`）。

再跑批量下载：

```bash
python .claude/skills/literature-pdf-ocr-library/scripts/pdf_recv.py \
  .pipeline/literature/<corpus-name>/ieee_download_queue.json 9876 &

python .claude/skills/literature-pdf-ocr-library/scripts/download_ieee_batch.py \
  .pipeline/literature/<corpus-name>/ieee_download_queue.json
```

脚本为每篇开新 Chrome tab（避免 Xplore APM 对长 session 的 tab fingerprinting），轮询页面 `ready=="complete"` 再发 fetch（解决 in-flight 导航导致的 `Failed to fetch`），2.5 s 间隔。典型 IEEE 批次命中率 35/38~38/38。个别 CDP 超时是误报（文件已 PUT 成功但脚本没等到 JS 返回），重跑一次 skip-if-exists 会判出来。

### 4b. OCR 转 Markdown

```bash
# PaddleOCR API（用户提供 Token）
export PADDLEOCR_TOKEN="<用户提供，不要写入文件>"
python .claude/skills/literature-pdf-ocr-library/scripts/paddleocr_layout_to_markdown.py \
  .pipeline/literature/<corpus-name>/papers/*/paper.pdf \
  --output-dir .pipeline/literature/<corpus-name>/papers \
  --skip-existing

# pdfminer fallback（用户已通过 AskUserQuestion 确认）
python .claude/skills/literature-pdf-ocr-library/scripts/paddleocr_layout_to_markdown.py \
  .pipeline/literature/<corpus-name>/papers/*/paper.pdf \
  --output-dir .pipeline/literature/<corpus-name>/papers \
  --fallback-pdfminer
```

### 4c. 生成索引

```bash
python .claude/skills/literature-pdf-ocr-library/scripts/build_library_index.py \
  --library-root .pipeline/literature/<corpus-name>
```

### 4d. 补充搜索（元数据层）

调用 `inno-deep-research` skill 搜索 OCR 没有覆盖的方向，每个方向至少找 5 篇。

### 4e. 更新 literature_bank.md

将所有论文逐条追加（含 OCR 路径字段）：

```
| [URL] | Title | Year | Venue | Relevance | accepted | Date | OCR路径 |
```

OCR 路径填实际路径，例如：
`.pipeline/literature/humanoid-core/papers/2502-13817-asap/ocr/paper/doc_0.md`
没有 OCR 的填 `none`。

完成后生成 `.pipeline/docs/gap_matrix.md` 分析研究空白，更新 `.pipeline/memory/agent_handoff.md`。

## 第五步：展示结果摘要

结果回来后告诉用户：

- 下载了多少篇（按 arxiv / acm / ieee 桶分别给数）、OCR 成功多少篇
- 新增了多少篇（总计多少篇）
- 主要覆盖了哪些方向
- gap_matrix.md 找到了哪几个研究空白

用 `AskUserQuestion` 询问：
- `够了，进入 /omp:ideate`
- `还需要补充搜索某个方向`
- `看看 gap_matrix 后再决定`
