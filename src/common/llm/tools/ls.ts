import fs from 'node:fs/promises'
import path from 'node:path'
import { tool } from 'ai'
import picomatch from 'picomatch'
import { z } from 'zod'

// 默认忽略的噪点目录和文件，防止上下文爆炸
const DEFAULT_IGNORES = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.DS_Store',
  'bun.lockb',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '**/*.log',
]

// 安全限制
const MAX_OUTPUT_CHARS = 15000 // 字符数熔断
const MAX_ENTRIES = 300 // 单次最大返回条目数 (Page Size)
const MAX_DEPTH = 10 // 最大递归深度

export const lsTool = tool({
  description:
    'List files and directories at a specified path. Supports filtering, recursion, and pagination (skip).',
  parameters: z.object({
    path: z
      .string()
      .describe('The absolute path to list contents from.')
      .default('.'),
    recursive: z
      .boolean()
      .describe('Whether to list contents recursively')
      .default(false),
    includeHidden: z
      .boolean()
      .describe('Whether to include hidden files (starting with .)')
      .default(false),
    ignore: z
      .array(z.string())
      .optional()
      .describe('Additional glob patterns to ignore (e.g. ["**/*.test.ts"])'),
    skip: z
      .number()
      .describe('Number of files/directories to skip from the beginning (for pagination).')
      .default(0),
  }),
  execute: async ({ path: dirPath, recursive, includeHidden, ignore = [], skip = 0 }) => {
    try {
      // 1. 准备过滤规则
      const ignorePatterns = [...DEFAULT_IGNORES, ...ignore]
      const isIgnored = picomatch(ignorePatterns)

      // 2. 初始化状态追踪器
      const stats = {
        scanned: 0, // 总共遍历到的有效条目数 (用于和 skip 比较)
        collected: 0, // 当前页实际收集到的条目数 (用于和 MAX_ENTRIES 比较)
        truncated: false, // 标记是否发生了截断
        skip: skip, // 传入的跳过数量
      }

      const output: string[] = []

      // 3. 执行递归列表
      await listDirectory({
        currentPath: dirPath,
        basePath: dirPath,
        recursive,
        includeHidden,
        isIgnored,
        depth: 0,
        output,
        stats,
      })

      // 4. 构建返回结果
      let result = output.join('\n')

      // 场景一：字符长度熔断
      if (result.length > MAX_OUTPUT_CHARS) {
        result = result.substring(0, MAX_OUTPUT_CHARS)
        result += `\n\n[SYSTEM WARNING]: Output truncated due to excessive length (> ${MAX_OUTPUT_CHARS} chars). Please narrow your search path.`
      }
      // 场景二：条目数量截断 (分页提示)
      else if (stats.truncated) {
        const nextSkip = skip + stats.collected
        result += `\n\n[SYSTEM NOTE]: Listing truncated after ${stats.collected} entries (total scanned: ${stats.scanned}). To see the next batch, run 'ls' again with "skip": ${nextSkip}.`
      }
      // 场景三：虽然没有截断，但可能原本就没有内容（或者都被 skip 了）
      else if (output.length === 0 && stats.scanned > 0) {
        result = `[SYSTEM NOTE]: No files displayed. You skipped ${skip} entries, and there were no more entries after that.`
      }

      return result
    } catch (error) {
      return `Error listing directory: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})

interface ListDirOptions {
  currentPath: string
  basePath: string
  recursive: boolean
  includeHidden: boolean
  isIgnored: (path: string) => boolean
  depth: number
  output: string[]
  stats: {
    scanned: number
    collected: number
    truncated: boolean
    skip: number
  }
}

const listDirectory = async ({
  currentPath,
  basePath,
  recursive,
  includeHidden,
  isIgnored,
  depth,
  output,
  stats,
}: ListDirOptions): Promise<void> => {
  // 达到限制，停止递归
  if (stats.truncated || depth > MAX_DEPTH) return

  try {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })

    // 排序：目录优先，文件名升序
    entries.sort((a, b) => {
      if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name)
      return a.isDirectory() ? -1 : 1
    })

    for (const entry of entries) {
      if (stats.truncated) break

      // 1. 基础过滤 (隐藏文件)
      if (!includeHidden && entry.name.startsWith('.')) continue

      // 2. 智能过滤 (Ignore Pattern)
      const fullPath = path.join(currentPath, entry.name)
      const relativePath = path.relative(basePath, fullPath)
      if (isIgnored(entry.name) || isIgnored(relativePath)) continue

      // 3. 计数逻辑
      stats.scanned++ // 发现了一个有效条目

      // 4. 分页判断
      // 只有当“已扫描总数”大于“需要跳过数”时，才开始处理输出
      const shouldCollect = stats.scanned > stats.skip

      if (shouldCollect) {
        // 检查当前页是否已满
        if (stats.collected >= MAX_ENTRIES) {
          stats.truncated = true
          break
        }

        // 添加到输出
        const prefix = '  '.repeat(depth)
        const mark = entry.isDirectory() ? '/' : ''
        output.push(`${prefix}${entry.name}${mark}`)
        stats.collected++
      }

      // 5. 递归处理 (即使当前目录被 skip 了，也需要进去遍历子文件，否则无法计数)
      if (entry.isDirectory() && recursive) {
        await listDirectory({
          currentPath: fullPath,
          basePath,
          recursive,
          includeHidden,
          isIgnored,
          depth: depth + 1,
          output,
          stats,
        })
      }
    }
  } catch (error) {
    // 忽略访问权限等错误，只在输出中标记
    if (stats.scanned > stats.skip && stats.collected < MAX_ENTRIES) {
      output.push(`${'  '.repeat(depth)}[Error accessing ${path.basename(currentPath)}]`)
    }
  }
}