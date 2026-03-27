<p align="center">
  <img src="./icons/icon.png" alt="ViewerLeaf" width="140" height="140" />
</p>

<h1 align="center">ViewerLeaf</h1>

<p align="center">
  <strong>The Visual Research Workbench — From Literature to Publication, All in One Place</strong>
</p>

<p align="center">
  <em>可视化科研工作台 — 从文献到发表，一站式自主科研</em>
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#architecture"><strong>Architecture</strong></a> ·
  <a href="#getting-started"><strong>Getting Started</strong></a> ·
  <a href="#中文说明"><strong>中文说明</strong></a> ·
  <a href="#license"><strong>License</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/version-0.2.1-green?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/Tauri-v2-blueviolet?style=flat-square" />
  <img src="https://img.shields.io/badge/skills-34-ff69b4?style=flat-square" />
</p>

---

## Why ViewerLeaf?

Research is messy. You jump between paper PDFs, code editors, remote servers, LaTeX compilers, reference managers, and AI assistants — each in a different window, each losing context.

**ViewerLeaf is the unified entry point for autonomous research.** It wraps the entire research lifecycle — literature survey, idea generation, experiment execution, paper writing, and academic promotion — into a single desktop workbench, orchestrated by AI agents that understand your project state.

> 🔬 Think of it as an **IDE for research**, not just for code.

---

## Features

### 🧠 AI-Powered Research Pipeline

A five-stage structured workflow that drives your project from idea to publication:

```
Survey → Ideation → Experiment → Publication → Promotion
```

Each stage comes with **auto-generated task trees**, **recommended skills**, and **context-aware agent prompts**. The AI agent reads your project state (`tasks.json`, `research_brief.json`) and knows exactly what to do next.

### 🤖 Agent Integration

- **Claude Code** and **Codex** CLI agents embedded with a full terminal interface
- Agents are **project-aware** — they read `CLAUDE.md`/`AGENTS.md`, understand the pipeline stage, and follow skill instructions
- **34 built-in research skills** covering literature search, idea evaluation, experiment development, paper writing, figure generation, reference auditing, and more

### 🧪 Auto-Experiment Loop

Set a success metric, point to a remote compute node, and let the system iterate autonomously:

```
Modify code → Sync to server → Execute → Parse metrics → Repeat until goal met
```

- Remote compute via SSH/rsync with `compute-helper` CLI
- Configurable success thresholds, max iterations, and failure limits
- Real-time run-state tracking in the UI

### 📝 LaTeX Workbench

- **CodeMirror 6** editor with LaTeX syntax highlighting, outline extraction, and comment gutter
- **pdf.js** preview with SyncTeX-style bidirectional navigation
- `latexmk` compile pipeline with diagnostics, log display, and auto-compile toggle
- Multi-file project tree with drag-and-drop, file/folder creation, and workspace tabs

### 📊 Research Canvas

- Visual task tree across all five stages with progress tracking
- Stage initialization, task CRUD, and AI-suggested task decomposition
- Pipeline artifact browser linking each stage to its outputs

### 🖥️ Integrated Terminal

- Full PTY-based terminal panel alongside the editor
- Run agent CLIs, SSH sessions, and build commands without leaving the workbench

### 💬 Remote Control

- Optional **WeChat** (via cc-connect) and **Telegram** bot integration
- Send instructions to your agents from your phone while experiments run

### ☁️ Collaboration (Optional)

- Cloudflare Worker-based real-time sync with role-based access
- Share links, review comments, and deployment helpers

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  ViewerLeaf App                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  Editor   │  │   PDF    │  │  Research Canvas │  │
│  │(CodeMirror│  │ (pdf.js) │  │  (Task Tree +    │  │
│  │   + LaTeX)│  │          │  │   Stage Tracker) │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Terminal  │  │  Agent   │  │   Skill Engine   │  │
│  │  (PTY)   │  │(Claude/  │  │  (34 built-in    │  │
│  │          │  │  Codex)  │  │   research skills)│  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
├─────────────────────────────────────────────────────┤
│               Tauri (Rust Backend)                  │
│  Compile · Agent · Terminal · Skill · Research ·    │
│  Experiment · Provider · Profile · File · Sync      │
├─────────────────────────────────────────────────────┤
│            Node Sidecar + compute-helper            │
│  Claude Code SDK · Codex Runner · Remote SSH/rsync  │
└─────────────────────────────────────────────────────┘
```

### Repository Layout

| Path | Purpose |
|------|---------|
| `src/` | React + Vite frontend — editor, preview, canvas, sidebar, settings |
| `src-tauri/` | Rust backend — file I/O, compile, terminal, agent orchestration, skill engine |
| `sidecar/` | Node sidecar — runs Claude Code / Codex CLIs, compute-helper for remote experiments |
| `skills/` | 34 built-in research skills with YAML frontmatter and markdown instructions |
| `templates/` | Project templates — `CLAUDE.md`, `AGENTS.md`, default pipeline config |
| `workers/` | Optional Cloudflare Worker collaboration backend |

### New Project Structure

When you create a project, ViewerLeaf scaffolds:

```
my-research/
├── paper/                  # LaTeX workspace
│   ├── main.tex
│   ├── sections/
│   └── refs/
├── experiment/             # Experiment code & scripts
├── survey/                 # Literature survey artifacts
├── ideation/               # Ideas, evaluations, plans
├── promotion/              # Slides, demos, outreach
├── skills/                 # Project-local skills
├── .pipeline/              # Task & brief state
├── CLAUDE.md               # Agent protocol
├── AGENTS.md               # Agent protocol (Codex)
└── instance.json           # Project identity
```

---

## Getting Started

### Prerequisites

| Tool | Required | Purpose |
|------|----------|---------|
| **Node.js** 20+ | ✅ | Frontend build, sidecar runtime |
| **Rust + Cargo** | ✅ | Tauri backend |
| **latexmk** | ✅ | LaTeX compilation |
| **synctex** | ✅ | Source ↔ PDF navigation |
| **Claude Code** / **Codex** | Optional | AI agent CLIs |
| **Wrangler** | Optional | Collaboration deployment |

### Development

```bash
# Clone and install
git clone https://github.com/LigphiDonk/viwerleaf.git
cd viwerleaf
npm install

# Run the desktop app (includes sidecar build)
npm run tauri dev

# Or run frontend only in browser
npm run dev
```

### Production Build

```bash
npm run tauri build
```

### Quality Checks

```bash
npm run test          # Vitest
npm run lint          # ESLint
cd src-tauri && cargo test --lib   # Rust unit tests
```

### macOS Install Note

GitHub Actions builds are unsigned. Remove quarantine after download:

```bash
xattr -dr com.apple.quarantine /Applications/ViewerLeaf.app
```

---

## 中文说明

### 什么是 ViewerLeaf？

ViewerLeaf 是一个面向科研人员的**可视化自主科研工作台**。它不是又一个 LaTeX 编辑器，而是把从文献调研到最终发表的**整个科研流程**整合进一个桌面应用，并用 AI Agent 驱动自动化。

### 核心理念

> 🎯 **Auto Research 的入口** — 让 AI 帮你跑实验、写论文、管任务，你只需要做最重要的科研决策。

### 五阶段科研流水线

```
文献调研 (Survey) → 创意生成 (Ideation) → 实验执行 (Experiment)
                  → 论文撰写 (Publication) → 推广传播 (Promotion)
```

每个阶段自动生成任务树，配备推荐 Skill，Agent 自动读取项目状态并执行下一步。

### 核心能力

| 能力 | 说明 |
|------|------|
| 🧠 **AI Agent** | 内置 Claude Code + Codex CLI，理解项目上下文，自主推进任务 |
| 🧪 **自动实验** | 修改代码 → 同步远端 → 执行评估 → 解析指标 → 自动迭代，直到达标 |
| 📝 **LaTeX 编辑** | CodeMirror 编辑器 + PDF 预览 + SyncTeX 跳转 + 自动编译 |
| 🎯 **34 个研究技能** | 文献检索、创意评估、实验开发、论文写作、图表生成、参考文献审计等 |
| 📊 **研究画布** | 可视化任务树、阶段进度、产出文件关联 |
| 🖥️ **终端** | 内置 PTY 终端，SSH/rsync/编译命令不离开工作台 |
| 💬 **远程控制** | 可选微信/Telegram 集成，手机发指令让 Agent 执行任务 |
| ☁️ **协作** | 可选 Cloudflare Worker 实时同步，支持分享、评论、角色化协作 |

### 新项目结构

创建项目后的目录布局：

```
my-research/
├── paper/          # LaTeX 工作区 (main.tex, sections/, refs/)
├── experiment/     # 实验代码与脚本
├── survey/         # 文献调研产出
├── ideation/       # 创意与方案评估
├── promotion/      # 演讲稿、推广材料
├── skills/         # 项目级技能
├── .pipeline/      # 任务与项目状态
├── CLAUDE.md       # Agent 协议
└── instance.json   # 项目身份
```

### 本地开发

```bash
git clone https://github.com/LigphiDonk/viwerleaf.git
cd viwerleaf && npm install
npm run tauri dev       # 启动桌面应用
```

### macOS 安装

GitHub Actions 构建产物未签名，下载后需移除 quarantine：

```bash
xattr -dr com.apple.quarantine /Applications/ViewerLeaf.app
```

---

## Roadmap

- [ ] Multi-platform support (Windows, Linux)
- [ ] Plugin marketplace for community skills
- [ ] Built-in reference manager with PDF annotation
- [ ] Experiment dashboard with metric visualization
- [ ] One-click deployment to arXiv / OpenReview

---

## License

MIT License. See [LICENSE](./LICENSE).

---

<p align="center">
  <strong>ViewerLeaf</strong> — Where Research Meets Automation 🍃
</p>
