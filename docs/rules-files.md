# Rules Files

Shippie automatically discovers and incorporates project-specific rules files into the review context, providing your AI reviewer with important context about coding standards, best practices, and project-specific guidelines.

## Overview

Rules files help the AI reviewer understand your project's:

- Coding standards and style guidelines
- Framework-specific best practices
- Security requirements
- Architecture patterns
- Custom linting rules

These files are automatically discovered from standard locations and intelligently incorporated into the review prompt.

## Rule Deduplication

Shippie automatically deduplicates rules to avoid redundancy:

- **Content-based**: Rules with identical content are automatically merged
- **Description-based**: Rules with very similar descriptions are deduplicated
- **Path preference**: When duplicates are found, more specific paths (e.g., `.cursor/rules/`) are preferred over root-level files

## Supported Directories

Shippie searches for rules files in these directories:

```
.cursor/rules/          # Cursor editor rules
.shippie/rules/         # Shippie-specific rules
.windsurfrules/         # Windsurf editor rules (legacy)
.windsurf/rules/        # Windsurf editor rules (preferred)
clinerules/             # CLI-specific rules
```

## Root-Level Rules Files

Additionally, these files in the project root are treated as rules files:

```
AGENTS.md               # AI agent instructions
## CoStric — 规则文件说明

CoStric 使用规则文件（rules files）为自动审查提供项目特定的上下文：风格规范、架构决策、安全要求和其它约束。

目录与文件类型：
- 推荐位置：`.costrict/rules/`、`.cursor/rules/` 或项目根目录下以 `.mdc` 为后缀的文件。
- 支持格式：`.mdc`（带 frontmatter）优先，`.md` 也可接受。

推荐 frontmatter 结构：

```yaml
---
description: 简短说明
globs: ["**/*.ts","src/**"]
alwaysApply: false
---
```

重要字段：
- `description`：规则摘要，用于提示列表。
- `globs`：适用文件模式。
- `alwaysApply`：为 `true` 时把整个规则内容完整地注入审查上下文（仅用于关键规则，如安全）。

最佳实践：
- 将安全与合规类规则设置为 `alwaysApply: true`。
- 每个文件聚焦一类规则（风格、架构、安全）。
- 使用明确的描述与适当 globs，以减小上下文负荷。

示例文件名：
- `typescript-style.mdc`
- `security-requirements.mdc` (alwaysApply: true)
- `react-patterns.mdc`

规则整合流程：CoStric 扫描规则目录 → 解析 frontmatter → 去重合并 → 构建审查上下文 → 交给模型进行审查。

