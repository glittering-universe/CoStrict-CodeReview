## Server Configuration Options

## CoStric — MCP（Model Context Protocol）使用说明

CoStric 支持通过 MCP 将外部工具（浏览器自动化、检索服务、私有索引等）挂载到审查 agent 的能力集中。

配置文件位置（示例）：`.costrict/mcp.json` 或 `.cursor/mcp.json`。

示例（混合命令与 URL）：

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "grep": {
      "url": "https://mcp.grep.app"
    }
  }
}
```

服务器类型：
- 命令型（command + args）：在 runner 上以子进程启动本地客户端。
- URL 型（SSE/HTTP）：通过网络访问长期运行的 MCP 服务。

安全与私密环境：
- 在 GitHub Actions 中，通过 secrets 注入敏感变量，避免把凭据写入仓库。
- 若需在 workflow 中使用私密 env，请使用 `${{ secrets.MY_TOKEN }}` 在动作步骤里传入。

使用提示：仅允许可信 MCP 服务和最小化权限的工具集合；在 `claude.yml` 或相似配置中列出 `allowed_tools` 以白名单方式限制可用命令。
    "args": ["-y", "@package/mcp-server"],
