# CoStric — 快速入门与安装

CoStric 是一个用 TypeScript + Bun 构建的代码审查工具，设计为在本地和 CI 中运行以提升 PR 质量。

先决条件
- Bun 1.x 或 Node 18+
- Git

在 CI 中（示例）

```yaml
name: CoStric CI
on: [pull_request]
jobs:
  review:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun i
      - run: bun review --platform=github --debug
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

本地运行

```bash
bun i
OPENAI_API_KEY=<your-key> bun review --platform=local
```

常用命令
- `bun review`：运行代码审查
- `bun test:unit`：运行单元测试
- `bun run build`：构建分发包

安全与配置
- 使用 repository secrets 存储 API keys；不要在仓库中提交凭据。
- 若使用 MCP 服务，请在 `.costrict/mcp.json` 中配置并在 workflow 中注入 secrets。

遇到问题
- 启用 `--debug` 获取详细日志；在本地先跑 `bun test:unit` 确保无回归再提交 PR。
