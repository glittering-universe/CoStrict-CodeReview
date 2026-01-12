# CoStrict Code Review 🤖

> An intelligent, security-first AI code reviewer that doesn't just guess—it **verifies**.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6.svg)

<div align="center">

[English](#english) | [中文 (Chinese)](#%E4%B8%AD%E6%96%87-chinese) | [日本語 (Japanese)](#%E6%97%A5%E6%9C%AC%E8%AA%9E-japanese)

</div>

---

<a name="english"></a>

## 🇺🇸 English

**CoStrict Code Review** is an advanced automated code review agent designed to integrate into your CI/CD pipeline or run locally. Unlike standard AI reviewers that merely hallucinate potential issues, CoStrict employs a **Sandbox Execution Environment** to validate suspected bugs and security vulnerabilities before reporting them, ensuring high-precision feedback with zero noise.

### ✨ Key Features

- **🛡️ Sandbox Verification**: Automatically spins up an isolated temporary environment to execute reproduction scripts. If a bug can't be reproduced, it's marked as `UNVERIFIED` or discarded.
- **🧠 Multi-Agent Architecture**: Orchestrates specialized sub-agents (Static Analysis, Logic, Security, Memory) to dive deep into specific domains.
- **🔌 Platform Agnostic**: Works seamlessly with **GitHub Actions**, **GitLab CI**, or your **Local Terminal**.
- **🤖 LLM Flexibility**: Compatible with OpenAI-protocol LLMs (GPT-4o, Claude via proxy, Xiaomi MiMo, etc.) via Vercel AI SDK.
- **📝 Structured Reporting**: Delivers verified bug reports as structured data cards, not just wall-of-text comments.
- **🔒 Security First**: Built-in checks to prevent dangerous commands execution during verification.

### 🚀 Quick Start

#### 1. Installation

```bash
# Clone the repository
git clone https://github.com/your-org/costrict-codereview.git
cd costrict-codereview

# Install dependencies (using Bun is recommended)
bun install
```

#### 2. Configuration

Create a `.env` file in the root directory:

```env
# Required: Your LLM Provider Config (OpenAI Compatible)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_API_BASE=https://api.openai.com/v1 # Or your custom provider URL
COSTRICT_MODEL=openai:gpt-4o

# Optional: GitHub Token (for PR comments)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

#### 3. Usage (Local)

Review your current working directory:

```bash
# Analyze staged changes (git diff --cached) - Pre-commit check
bun start

# Analyze working directory (unstaged changes) - While coding
REVIEW_UNSTAGED=true bun start

# Analyze a specific repository
cd /path/to/target/repo && /path/to/costrict/dist/index.js
```

### ⚙️ GitHub Action Integration

Add this tool to your Pull Request workflow to get automatic reviews.

Create `.github/workflows/review.yml`:

```yaml
name: CoStrict Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run AI Review
        uses: your-org/costrict-codereview@v1 # Replace with your published action
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          openai_api_base: https://api.xiaomimimo.com/v1 # Example custom provider
          model: openai:mimo-v2-flash
          custom_instructions: "Prioritize finding SQL injection and N+1 query issues."
```

### 🛠️ How It Works

1.  **Diff Analysis**: The agent fetches the diff of the Pull Request.
2.  **Sub-Agent Spawn**: It spawns specialized agents (e.g., Security Agent) to analyze the code from different perspectives.
3.  **Hypothesis**: When an agent suspects a runtime bug, it generates a reproduction script.
4.  **Sandbox Verification**:
    *   **Interactive (Local)**: The tool pauses and asks you to Approve the execution of the script.
    *   **CI Mode**: Can be configured to auto-approve safe commands.
    *   The script runs in a `/tmp/costrict-sandbox-xxx` folder, isolated from your main repo.
5.  **Reporting**:
    *   **Verified**: If the script fails (as expected), the bug is reported as `VERIFIED` with evidence.
    *   **Unverified**: If reproduction fails, it's flagged or discarded.

---

<a name="中文-chinese"></a>

## 🇨🇳 中文 (Chinese)

**CoStrict Code Review** 是一个先进的自动化代码审查 Agent，既可以集成到 CI/CD 流水线中，也可以在本地运行。与只是“猜测”潜在问题的普通 AI 审查器不同，CoStrict 引入了 **沙盒执行环境 (Sandbox Execution Environment)** 来验证可疑的 Bug 和安全漏洞。只有经过验证的问题才会被报告，从而确保高精度的反馈，拒绝噪音。

### ✨ 核心特性

- **🛡️ 沙盒验证**: 自动启动一个隔离的临时环境来执行复现脚本。如果 Bug 无法复现，它将被标记为 `UNVERIFIED` 或直接丢弃。
- **🧠 多 Agent 架构**: 编排专业的子 Agent（静态分析、逻辑、安全、内存）深入特定领域进行分析。
- **🔌 跨平台支持**: 完美支持 **GitHub Actions**、**GitLab CI** 以及您的 **本地终端**。
- **🤖 LLM 灵活性**: 通过 Vercel AI SDK 兼容任何 OpenAI 协议的 LLM（如 GPT-4o, 通过代理的 Claude, 小米 MiMo 等）。
- **📝 结构化报告**: 验证后的 Bug 报告以结构化数据卡片的形式呈现，而不仅仅是大段的文字评论。
- **🔒 安全优先**: 内置安全检查，防止在验证过程中执行 rm -rf 等危险命令。

### 🚀 快速开始

#### 1. 安装

```bash
# 克隆仓库
git clone https://github.com/your-org/costrict-codereview.git
cd costrict-codereview

# 安装依赖 (推荐使用 Bun)
bun install
```

#### 2. 配置

在项目根目录下创建一个 `.env` 文件：

```env
# 必需: 您的 LLM 提供商配置 (OpenAI 兼容)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_API_BASE=https://api.openai.com/v1 # 或您的自定义提供商 URL
COSTRICT_MODEL=openai:gpt-4o

# 可选: GitHub Token (用于 PR 评论)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

#### 3. 使用 (本地模式)

审查您当前的工作目录：

```bash
# 分析暂存区的变更 (git diff --cached) - 提交前检查
bun start

# 分析工作目录的变更 (未暂存) - 边写边查
REVIEW_UNSTAGED=true bun start

# 分析指定的仓库
cd /path/to/target/repo && /path/to/costrict/dist/index.js
```

### ⚙️ GitHub Action 集成

将此工具添加到您的 Pull Request 工作流中以获得自动审查功能。

创建 `.github/workflows/review.yml`:

```yaml
name: CoStrict Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run AI Review
        uses: your-org/costrict-codereview@v1 # 替换为您发布的 action 地址
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          openai_api_base: https://api.xiaomimimo.com/v1 # 示例：使用自定义提供商
          model: openai:mimo-v2-flash
          custom_instructions: "优先查找 SQL 注入和 N+1 查询问题。"
```

### 🛠️ 工作原理

1.  **Diff 分析**: Agent 获取 Pull Request 的差异内容。
2.  **子 Agent 派发**: 启动专门的子 Agent（如安全 Agent）从不同角度分析代码。
3.  **假设提出**: 当 Agent 怀疑存在运行时 Bug（例如“这个特定输入会触发崩溃”）时，它会生成一个复现脚本。
4.  **沙盒验证**:
    *   **交互式 (本地)**: 工具会暂停并询问您是否批准执行该脚本。
    *   **CI 模式**: (需配置) 可以配置为自动批准安全命令。
    *   脚本在 `/tmp/costrict-sandbox-xxx` 文件夹中运行，与主仓库隔离。
5.  **报告生成**:
    *   **已验证 (Verified)**: 如果脚本按预期失败（证明 Bug 存在），Bug 将被报告为 `VERIFIED` 并附带证据。
    *   **未验证 (Unverified)**: 如果复现失败，该问题将被标记或丢弃。

---

<a name="日本語-japanese"></a>

## 🇯🇵 日本語 (Japanese)

**CoStrict Code Review** は、CI/CD パイプラインへの統合やローカルでの実行を想定して設計された、高度な自動コードレビューエージェントです。潜在的な問題を単に「推測」するだけの標準的な AI レビュアーとは異なり、CoStrict は **サンドボックス実行環境 (Sandbox Execution Environment)** を採用し、疑わしいバグやセキュリティの脆弱性を報告する前に検証します。これにより、ノイズのない高精度なフィードバックを保証します。

### ✨ 主な機能

- **🛡️ サンドボックス検証**: 独立した一時環境を自動的に立ち上げ、再現スクリプトを実行します。バグが再現できない場合、それは `UNVERIFIED`（未検証）としてマークされるか、破棄されます。
- **🧠 マルチエージェントアーキテクチャ**: 静的解析、ロジック、セキュリティ、メモリなど、特定のドメインを深く掘り下げる専門のサブエージェントを調整します。
- **🔌 プラットフォーム非依存**: **GitHub Actions**、**GitLab CI**、または **ローカルターミナル** でシームレスに動作します。
- **🤖 LLM の柔軟性**: Vercel AI SDK を介して、OpenAI プロトコルの LLM（GPT-4o、プロキシ経由の Claude、Xiaomi MiMo など）と互換性があります。
- **📝 構造化レポート**: 検証されたバグ報告は、単なるテキストコメントではなく、構造化されたデータカードとして提供されます。
- **🔒 セキュリティファースト**: 検証中に危険なコマンドが実行されるのを防ぐための組み込みチェック機能があります。

### 🚀 クイックスタート

#### 1. インストール

```bash
# リポジトリをクローン
git clone https://github.com/your-org/costrict-codereview.git
cd costrict-codereview

# 依存関係のインストール (Bun の使用を推奨)
bun install
```

#### 2. 設定

ルートディレクトリに `.env` ファイルを作成します:

```env
# 必須: LLM プロバイダー設定 (OpenAI 互換)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_API_BASE=https://api.openai.com/v1 # またはカスタムプロバイダーの URL
COSTRICT_MODEL=openai:gpt-4o

# オプション: GitHub トークン (PR コメント用)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

#### 3. 使用方法 (ローカル)

現在の作業ディレクトリをレビューします:

```bash
# ステージングされた変更を分析 (git diff --cached) - コミット前
bun start

# 作業ディレクトリの変更を分析 (ステージング前) - コーディング中
REVIEW_UNSTAGED=true bun start

# 特定のリポジトリを分析
cd /path/to/target/repo && /path/to/costrict/dist/index.js
```

### ⚙️ GitHub Action 統合

このツールを Pull Request ワークフローに追加して、自動レビューを取得します。

`.github/workflows/review.yml` を作成します:

```yaml
name: CoStrict Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run AI Review
        uses: your-org/costrict-codereview@v1 # 公開された action に置き換えてください
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          openai_api_base: https://api.xiaomimimo.com/v1 # 例: カスタムプロバイダーの使用
          model: openai:mimo-v2-flash
          custom_instructions: "SQLインジェクションとN+1クエリの問題を優先的に探してください。"
```

### 🛠️ 仕組み

1.  **Diff 分析**: エージェントが Pull Request の差分を取得します。
2.  **サブエージェント生成**: コードをさまざまな視点から分析するために、専門のサブエージェント（例：セキュリティエージェント）を生成します。
3.  **仮説**: エージェントが実行時バグ（例：「この特定の入力がクラッシュを引き起こす」）を疑うと、再現スクリプトを生成します。
4.  **サンドボックス検証**:
    *   **インタラクティブ (ローカル)**: ツールは一時停止し、スクリプトの実行を承認するかどうかを尋ねます。
    *   **CI モード**: (要設定) 安全なコマンドを自動承認するように設定できます。
    *   スクリプトは、メインリポジトリから隔離された `/tmp/costrict-sandbox-xxx` フォルダで実行されます。
5.  **レポート**:
    *   **検証済み (Verified)**: スクリプトが（期待通りに）失敗した場合、そのバグは証拠とともに `VERIFIED` として報告されます。
    *   **未検証 (Unverified)**: 再現に失敗した場合、その問題はフラグ付けされるか、誤検知を減らすために破棄されます。

---

## 📄 License & Contributing

MIT © [Your Name/Organization]

Contributions are welcome! Please check out the [CONTRIBUTING.md](CONTRIBUTING.md) guide.
