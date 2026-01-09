# SubAgent Tool

The SubAgent tool allows spawning autonomous sub-agents that can work independently on specific tasks while having access to the same toolkit as the main agent. This is particularly useful for delegating complex, token-heavy operations that can run asynchronously. The sub-agent always returns a structured report with its findings and recommendations.

## Overview

The SubAgent tool creates an isolated agent instance that:

- Receives a specific goal/task to accomplish
- Has access to all base tools plus MCP (Model Context Protocol) tools
- Runs autonomously with a configurable step limit
- Always returns a structured report with findings and recommendations
- Handles resource cleanup automatically

### Preflight concurrency (Web UI)

When using the local web UI (`bun run start:web`), the server runs the four standard sub-agent “preflight” goals in parallel by default. You can tune concurrency (1–4) via `COSTRICT_SUBAGENT_PREFLIGHT_CONCURRENCY`.

## Usage

### Basic Usage

```typescript
import { createSubAgentTool } from "./common/llm/tools";

const subAgentTool = createSubAgentTool(model);

// The tool is then available to the main agent
const result = await subAgentTool.execute({
  goal: "Analyze the authentication system and identify potential security vulnerabilities",
});
```

### Tool Parameters

| Parameter | Type   | Required | Default | Description                                                                                     |
| --------- | ------ | -------- | ------- | ----------------------------------------------------------------------------------------------- |
| `goal`    | string | Yes      | -       | The specific goal or task for the sub-agent to accomplish. Include as much context as possible. |

## CoStric — SubAgent 工具说明

SubAgent 用于在 CoStric 中创建受限、自治的子任务代理，用于执行特定、资源密集或长时间运行的分析任务，并返回结构化报告。

核心特性：
- 独立执行：子代理在隔离环境中运行，带有工具白名单与步数限制。
- 可用工具：文件读取、搜索(`grep`)、HTTP 请求、受限 Bash、MCP 提供的外部工具。
- 报告输出：返回 `summary`、`findings`、`recommendations` 与执行元信息。

使用示例：

```ts
const result = await subAgentTool.execute({
  goal: '检查 auth 模块中的潜在权限绕过和凭证泄露',
  maxSteps: 30
});
```

设计要点：
- 步数限制避免无限循环；默认低步数用于短任务，高步数用于深入分析。
- 子代理不能继续生成新的子代理（防止递归）。
- 所有敏感操作（写入、发布）均需人工确认或在受信任环境下运行。

预执行（preflight）并行度（Web UI）：
- 本地 Web UI（`bun run start:web`）默认并行运行 4 个标准子代理目标。
- 可通过 `COSTRICT_SUBAGENT_PREFLIGHT_CONCURRENCY` 调整并行度（1–4）。

最佳实践：
- 明确描述目标并限定目标范围。
- 指定相关文件路径以缩小搜索空间。
- 对高风险任务（如自动修复）保留人工审阅环节。

安全提示：仅在受信任 runner 或私有 MCP 上运行子代理；避免将 secrets 直接暴露给外部服务。
- Any additional tools provided by configured Model Context Protocol servers
