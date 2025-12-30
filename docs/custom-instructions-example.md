# Custom Instructions Example

The `--customInstructions` flag allows you to provide specific guidance to the review agent.

## CoStric — 定制指令示例

`--custom-instructions`（或 `--customInstructions`）允许你向模型传递临时的审查焦点。

示例用法：

```bash
bun review --custom-instructions="重点检查安全和凭证泄露"
```

常用指令示例：
- 安全："关注 SQL 注入、敏感信息泄露、未加密的凭证"
- 性能："关注长循环、内存泄漏、低效的数据库查询"
- 风格/可维护性："确保函数短小、命名一致、添加单元测试建议"

注意：定制指令应简短明确，避免与仓库全局 rules 冲突；对影响 CI 的操作要保守。 
```bash
