# Shippie CI/CD 

### Option 1: Review every PR to main

Trigger a code review on any PR into main, updating it each time you push changes.

## CoStric — Action 选项

本文档列出 `CoStric` 在 CI 或本地运行时常用的命令行选项与示例，用于在 workflow 中合理调用 code review 功能。

- `--platform`：运行平台，取值 `github` 或 `local`，默认 `github`。
- `--debug`：启用详细调试日志（仅在故障排查时使用）。
- `--base-sha`：用于差异分析的基线提交 SHA（通常使用 `github.event.pull_request.base.sha`）。
- `--report-format`：输出格式，支持 `summary`、`json`、`sarif`。
- `--custom-instructions`：附加给模型的定制指令字符串，用于调整关注点（安全、性能等）。

示例 — GitHub Actions 中运行 CoStric：

```yaml
- name: Run CoStric review
  run: bun review --platform=github --debug --report-format=summary
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

示例 — 本地运行：

```bash
OPENAI_API_KEY=<your-key> bun review --platform=local --report-format=json
```

安全原则：自动化修改（如依赖升级、文件删除）必须始终伴随人工审批。***
This option can save on API costs by only reviewing when explicity asked to. It can also be used to avoid reviewing PRs before they are ready (draft/WIP PRs).


