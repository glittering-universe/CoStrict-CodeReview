# CoStric (costric_new)

CoStric 是一个用于代码审查与自动化检查的工具原型，结合静态规则与 AI 驱动的审查流程，适用于本地开发与 CI 集成。

## 主要特性
- 基于规则和提示的自动代码审查
- 可配置的审查模板和规则文件
- 支持在本地与 CI（示例：GitHub Actions）中运行
- 提供前端界面和后台服务（项目中包含 web/ 与 src/）

## 快速开始

1. 克隆仓库并进入目录：
```bash
git clone <your-repo-url>
cd CoStric_new
```

2. 安装依赖（使用 Bun）：
```bash
bun install
```

3. 运行（开发 / 测试）：
```bash
bun run index.ts
```

> 如果使用 npm / pnpm，可根据 package.json 中脚本替换相应命令。

## 项目结构（概览）
- src/ — 后端与核心逻辑（TypeScript）
- web/ — 前端应用（React + Vite）
- docs/ — 使用与配置说明
- templates/ — CI / GitHub Actions 模板
- .env — 环境变量（请根据需要创建/修改）

## 配置
- 在根目录放置或修改 `.env` 来配置模型密钥与其它凭证。
- 参考 docs/ 内的文档来自定义规则和提供者配置。

## 贡献
欢迎提交 issue 与 PR。请查看 CONTRIBUTING.md 以了解贡献流程与代码规范。

## 许可证
本项目使用 MIT 协议，详见 LICENSE 文件。
 
