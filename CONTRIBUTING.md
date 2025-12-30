# 贡献指南 (Contributing Guide)

感谢你对 CoStrict Code Review 项目的关注！我们欢迎各种形式的贡献，包括但不限于：

- 🐛 报告 Bug
- 💡 提出新功能建议
- 📝 改进文档
- 🔧 提交代码修复
- ✨ 添加新功能
- 🧪 编写测试

## 开发环境设置

### 前置要求

- **Node.js**: 16.x 或更高版本
- **Bun**: 1.x 或更高版本（推荐用于包管理和脚本执行）
- **Git**: 用于版本控制

### 安装步骤

1. **克隆仓库**

```bash
git clone https://github.com/glittering-universe/CoStrict-CodeReview.git
cd costrict-code-review
```

2. **安装依赖**

```bash
bun install
```

3. **安装 Web 应用依赖**

```bash
cd web
bun install
```

## 开发工作流

### 代码检查和格式化

项目使用 Biome 进行代码检查和格式化：

```bash
# 检查代码
bun run check

# 自动修复问题
bun run check:fix

# 类型检查
bun run check:types
```

### 运行测试

```bash
# 运行所有单元测试
bun test:unit

# 运行特定测试文件
bun test path/to/file.test.ts

# 运行端到端测试（需要设置环境变量）
bun test:e2e
```

### 构建项目

```bash
# 构建主项目
bun run build

# 构建 Web 应用
cd web
bun run build
```

### 运行开发服务器

**主项目开发**:

```bash
# 启动本地审查流程
bun run review --platform=local --debug
```

**Web 应用开发**:

```bash
cd web
bun run dev
```

Web 应用默认运行在 `http://localhost:5173`

## 项目结构

```
costrict-code-review/
├── src/                      # 主项目源代码
│   ├── review/              # 审查相关逻辑
│   ├── configure/           # 配置管理
│   ├── common/              # 共享工具和类型
│   │   ├── llm/            # LLM 相关功能
│   │   ├── platform/       # 平台集成（GitHub、本地）
│   │   └── tools/          # MCP 工具
│   └── specs/              # 测试场景和工具
├── web/                     # Web 应用源代码
│   ├── src/
│   │   ├── components/     # React 组件
│   │   ├── visual/         # 视觉效果组件
│   │   └── types.ts        # 类型定义
│   └── public/             # 静态资源
├── docs/                    # 项目文档
├── templates/               # GitHub Actions 模板
├── .roo/                    # 项目规则和配置
│   └── rules-code/         # 编码规范
└── .same/                   # 任务列表和规划
```

## 编码规范

### 组件设计

- 使用 **PascalCase** 命名组件文件和组件名称
- 组件应放在单独的文件中并按功能分组
- 保持组件单一职责，创建可复用和可测试的组件

### 状态管理

- 使用 TypeScript 明确定义状态类型
- 状态应尽可能简单和扁平化
- 使用函数式更新避免依赖当前状态
- 状态逻辑应与 UI 渲染逻辑分离

### 类型系统

- 为所有变量、参数、返回值定义明确的类型
- 优先使用具体类型而非 `any` 或 `unknown`
- 启用严格的 TypeScript 编译选项
- 提取通用类型定义以便复用

### 样式规范

- 使用 CSS 变量定义设计令牌和主题
- 样式应按组件或功能模块组织
- 避免全局样式污染组件样式
- 支持响应式设计和主题切换

详细的编码规范请参阅 [`.roo/rules-code/coding-standards.md`](.roo/rules-code/coding-standards.md)

## 提交规范

### 提交消息格式

项目遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型（type）**:

- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响代码运行的变动）
- `refactor`: 重构（既不是新增功能，也不是修改 bug 的代码变动）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建过程或辅助工具的变动
- `ci`: CI 配置文件和脚本的变动

**示例**:

```bash
feat(review): 添加上下文窗口管理功能

实现了智能的上下文压缩机制，当接近 token 限制时自动
压缩历史消息以保持审查能力。

Closes #123
```

### Pull Request 流程

1. **创建分支**

```bash
git checkout -b feature/your-feature-name
```

2. **进行更改**

   - 编写代码
   - 添加或更新测试
   - 更新相关文档

3. **提交更改**

```bash
git add .
git commit -m "feat: 添加新功能描述"
```

4. **推送分支**

```bash
git push origin feature/your-feature-name
```

5. **创建 Pull Request**

   - 在 GitHub 上创建 PR
   - 填写 PR 模板
   - 关联相关 Issue
   - 等待 Code Review

6. **回应反馈**

   - 根据反馈进行修改
   - 持续更新 PR
   - 确保所有 CI 检查通过

## 代码审查

### 提交前检查清单

在提交 PR 前，请确保：

- [ ] 代码通过 `bun run check` 检查
- [ ] 代码通过 `bun run check:types` 类型检查
- [ ] 所有测试通过 (`bun test:unit`)
- [ ] 添加了必要的单元测试
- [ ] 更新了相关文档
- [ ] 遵循了编码规范
- [ ] 提交消息符合 Conventional Commits 规范

### Code Review 重点

审查者会关注以下方面：

- 代码质量和可读性
- TypeScript 类型安全
- 测试覆盖率和质量
- 性能影响
- 用户体验
- 文档完整性
- 向后兼容性

## 测试

### 单元测试

```bash
# 运行所有单元测试
bun test:unit

# 运行特定测试文件
bun test src/review/utils/filterFiles.test.ts
```

### 端到端测试

```bash
# 设置环境变量
export OPENAI_API_KEY=your_api_key
export BASE_SHA=origin/main
export GITHUB_SHA=HEAD

# 运行端到端测试
bun test:e2e
```

### 测试最佳实践

- 使用 `bun:test` 框架
- 将测试文件放在 `specs/` 文件夹中
- 测试文件命名遵循 `*.test.ts` 格式
- 保持测试独立和可重复执行
- 使用有意义的测试名称

## 文档

### 文档结构

- `docs/` - 主项目文档
- `web/README.md` - Web 应用文档
- `.roo/` - 项目规则和规范
- `CHANGELOG.md` - 变更日志

### 更新文档

- 添加新功能时更新相关文档
- 使用清晰简洁的语言
- 提供代码示例
- 保持文档与代码同步

## 常见问题

### 依赖问题

如果遇到依赖问题，尝试：

```bash
rm -rf node_modules bun.lockb
bun install
```

### 类型错误检查

如果遇到类型错误，运行：

```bash
bun run check:types
```

### 测试失败

如果测试失败，检查：

1. 环境变量是否正确设置
2. 依赖是否正确安装
3. 测试数据是否有效

## 获取帮助

- 📖 查看 [README.md](README.md) 了解项目概况
- 📚 阅读 [docs/](docs/) 目录下的文档
- 🐛 在 [Issues](https://github.com/your-org/costrict-code-review/issues) 中报告问题
- 💬 在 [Discussions](https://github.com/your-org/costrict-code-review/discussions) 中提问

## 行为准则

- 保持尊重和包容的态度
- 提供建设性的反馈
- 感谢贡献者的工作
- 关注技术问题而非个人

## 许可证

通过贡献代码，你同意你的贡献将根据项目的许可证进行许可。

---

再次感谢你的贡献！🎉
