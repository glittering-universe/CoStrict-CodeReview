# Provider Configuration

Shippie supports OpenAI, Anthropic, Google Gemini, GitHub Models, and local models through an OpenAI compatible API.

Just change the `modelString` to the model you want to use.

## Credentials

For OpenAI-compatible providers, you can provide credentials via:

- Environment variables: `OPENAI_API_KEY`, `OPENAI_API_BASE`
- CLI flags: `--apiKey`, `--baseUrl`
- Local credentials file: `~/.shippie/credentials.json` (or `${REPO_ROOT}/.shippie/credentials.json`)

Note: `.env` is only loaded when `SHIPPIE_LOAD_DOTENV=true`.

eg.

```yaml
- name: Run shippie review
  run: bun review --platform=github --modelString=azure:gpt-4o
```

## GitHub Models

GitHub Models provides free access to AI models directly in GitHub Actions using the built-in `GITHUB_TOKEN`. This is the easiest setup option as it requires no additional API keys or secrets.

### Usage

When configuring shippie with `npx shippie configure --platform=github`, choose the GitHub Models option for automatic setup.

Or manually configure your workflow:

```yaml
permissions:
  models: read
```

```yaml
- name: Run shippie review
  run: bun shippie review --platform=github --modelString=openai:gpt-4o-mini --baseUrl=https://models.github.ai/inference
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
    GITHUB_SHA: ${{ github.sha }}
    OPENAI_API_KEY: ${{ secrets.GITHUB_TOKEN }}  # GitHub Models uses GITHUB_TOKEN as API key
```

You can also try this locally by generating a Personal Access Token (classic) and using that as the API key.

## Azure OpenAI Provider

This section will guide you through configuring and using the Azure OpenAI provider in your Code Review project, which leverages Large Language Models (LLMs) to enhance your code quality and prevent bugs before they reach production.
## CoStric — AI 提供者配置

CoStric 支持多种 LLM 提供者（OpenAI 兼容 API、Anthropic、GitHub Models、本地模型等）。下面说明常见配置和安全实践。

1) 环境变量与 Secrets
- `OPENAI_API_KEY`：OpenAI 兼容提供者的 API Key
- `ANTHROPIC_API_KEY`：Anthropic (Claude) 的 API Key
- `OPENAI_API_BASE`：可选，覆盖默认 API 基址

2) 在 CI 中使用 GitHub Models
- 在 workflow 中添加权限：

```yaml
permissions:
  models: read
```

并在运行步骤中使用 `OPENAI_API_KEY: ${{ secrets.GITHUB_TOKEN }}` 配合 `--baseUrl=https://models.github.ai/inference`。

3) Azure / 私有部署 / 本地模型
- Azure OpenAI：在 CI 中设置 `AZURE_RESOURCE_NAME`、`AZURE_API_KEY`、`AZURE_API_VERSION` 并使用 `--modelString=azure:<deployment>`。
- 本地模型（LM Studio / Ollama 等）：通过 `--baseUrl` 指向本地推理服务并使用本地凭据。

示例（GitHub Actions）：

```yaml
- name: Run CoStric review
  run: bun review --platform=github --modelString=openai:gpt-4o --baseUrl=https://api.openai.com/v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

安全提示：不要把凭据写入仓库，始终使用 repository secrets；在多模型环境中，优先选择最小权限模型与白名单策略。 
