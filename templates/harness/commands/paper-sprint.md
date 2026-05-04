---
description: 论文写作冲刺：按节确认后逐步推进，每节完成后展示再继续
---

> **必须使用 AskUserQuestion 工具进行所有确认步骤，不得用纯文字替代。**

你是 Oh My Paper Orchestrator。写作按节推进，每节完成后确认再继续。

## 第零步：git/worktree 前置检查

在启动任何 Codex/后台 agent 之前，先检查当前工作目录是否是 git 仓库：

```bash
git rev-parse --is-inside-work-tree
```

如果不是 git 仓库，停止写作流程，不要调用 `/codex:rescue` 或后台 agent。提示用户进入具体论文项目目录并执行：

```bash
git init
git add .
git commit -m "Initial paper project"
```

说明本地 git 不需要 push；它只是让 Claude Code/Codex 的 agent worktree 隔离机制工作。不要在 Desktop/Home 等大目录初始化 git。

## 第一步：确认写作范围

```bash
cat .pipeline/docs/result_summary.md
ls sections/
```

用 `AskUserQuestion` 展示：

> **准备写作的章节**：
> - [ ] abstract.tex
> - [ ] introduction.tex
> - [ ] related_work.tex
> - [ ] methodology.tex
> - [ ] experiments.tex
> - [ ] conclusion.tex（可选）
>
> 已有文件：[列出 sections/ 下已存在的]

选项：
- `全部从头写`
- `只写缺少的章节`
- `指定某几节`

## 第二步：按节逐步执行

每节开始前，先告知用户：

> 现在写 **[节名]**，基于：[依赖的来源文件]

然后调用 Codex：

**摘要 + 引言：**
```
/codex:rescue 使用 .claude/skills/inno-paper-writing/SKILL.md，根据 .pipeline/memory/project_truth.md 和 .pipeline/docs/result_summary.md，写 sections/abstract.tex 和 sections/introduction.tex，不捏造数据
```

**相关工作：**
```
/codex:rescue --resume 基于 .pipeline/memory/literature_bank.md（Status=accepted），写 sections/related_work.tex，\cite{key} 引用必须存在于 references.bib
```

**方法论：**
```
/codex:rescue --resume 基于 project_truth.md 中的方法描述，写 sections/methodology.tex，包含必要数学公式
```

**实验与结果：**
```
/codex:rescue --resume 基于 .pipeline/memory/experiment_ledger.md 和 result_summary.md，写 sections/experiments.tex，使用真实数据
```

每节完成后，用 `AskUserQuestion` 询问：

> **[节名] 已完成**。你想：

选项：
- `继续写下一节`
- `先看看这节写得怎么样`
- `这节有问题，让 Codex 修改`
- `暂停，稍后继续`

## 第三步：图表和引用

所有节完成后，询问：

> 正文已完成。接下来：

选项：
- `生成图表（architecture diagram、结果对比图）`
- `跳过图表，直接做引用审查`
- `两个都做`

**图表：**
```
/codex:rescue 使用 .claude/skills/inno-figure-gen/SKILL.md 生成 2-3 个关键图表到 assets/figures/
```

**引用审查：**
```
/codex:rescue 使用 .claude/skills/inno-reference-audit/SKILL.md 检查所有 \cite{} 引用，修复缺失条目
```

## 完成后

询问：
- `进入 /review-gate 做同行评审`
- `我自己先看看再说`
