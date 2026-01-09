import crypto from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { type Tool, generateText, tool } from 'ai'
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { Octokit } from 'octokit'
import { loadDotenv } from './common/config/dotenv'
import { loadLlmCredentials, resolveLlmCredentials } from './common/config/llmCredentials'
import {
  resolveGitRootFromPath,
  withWorkspaceRoot,
} from './common/git/getChangedFilesNames'
import { getFilesWithChanges } from './common/git/getFilesWithChanges'
import { type LocalRepoScanResult, scanLocalGitRepos } from './common/git/scanLocalRepos'
import { checkoutGitHubPullRequest } from './common/github/checkoutPullRequest'
import { resolveGitHubTokenFromGh } from './common/github/githubCli'
import {
  parseGitHubPullRequestUrl,
  toGitHubPullRequestUrl,
} from './common/github/pullRequest'
import {
  fetchGitHubPullRequestDetails,
  fetchGitHubPullRequestDiff,
} from './common/github/pullRequestApi'
import { MCPClientManager } from './common/llm/mcp/client'
import { createModel } from './common/llm/models'
import { stripProviderJsonFromText } from './common/llm/stripProviderJson'
import { getAllTools } from './common/llm/tools'
import type {
  SandboxExecApprovalResponse,
  SandboxExecOnEvent,
} from './common/llm/tools/sandboxExec'
import { createCachedSubAgentTool } from './common/llm/tools/subAgentCache'
import { summarizeSubAgentReportForContext } from './common/llm/tools/subAgentSummary'
import { createWebProvider } from './common/platform/web/webProvider'
import { PlatformOptions } from './common/types'
import { logger } from './common/utils/logger'
import { withGitHubEnvVariables } from './config'
import { reviewAgent } from './review/agent/generate'
import { constructPrompt } from './review/prompt'
import { filterFiles } from './review/utils/filterFiles'

loadDotenv()

const app = new Hono()
const sandboxWaiters = new Map<
  string,
  { resolve: (response: SandboxExecApprovalResponse) => void }
>()
const githubOauthStates = new Map<string, { origin: string; createdAt: number }>()

const normalizeBaseUrl = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/\/$/, '')
}

const maskApiKey = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}…`
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`
}

const resolveSsePingIntervalMs = (): number => {
  const raw = process.env.COSTRICT_SSE_PING_INTERVAL_MS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 5000
}

const resolveServerIdleTimeoutSeconds = (): number => {
  const raw = process.env.COSTRICT_SERVER_IDLE_TIMEOUT
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0) return parsed
  return 120
}

const resolveSandboxExecRepeatLimit = (): number => {
  const raw = process.env.COSTRICT_SANDBOX_EXEC_REPEAT_LIMIT
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 2) return parsed
  return 4
}

const resolveGitHubOAuthClientId = (): string =>
  process.env.COSTRICT_GITHUB_OAUTH_CLIENT_ID?.trim() ?? ''

const resolveGitHubOAuthClientSecret = (): string =>
  process.env.COSTRICT_GITHUB_OAUTH_CLIENT_SECRET?.trim() ?? ''

const resolveGitHubOAuthRedirectUri = (apiOrigin: string): string => {
  const override = process.env.COSTRICT_GITHUB_OAUTH_REDIRECT_URI?.trim()
  if (override) return override
  return `${apiOrigin}/api/github/oauth/callback`
}

const cleanupGitHubOauthStates = (ttlMs = 10 * 60_000) => {
  const now = Date.now()
  for (const [state, entry] of githubOauthStates.entries()) {
    if (now - entry.createdAt > ttlMs) {
      githubOauthStates.delete(state)
    }
  }
}

const resolveRepoScanMaxDepth = (): number => {
  const raw = process.env.COSTRICT_REPO_SCAN_MAX_DEPTH
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0) return parsed
  return 6
}

const resolveRepoScanMaxResults = (): number => {
  const raw = process.env.COSTRICT_REPO_SCAN_MAX_RESULTS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 200
}

const resolveRepoScanCacheTtlMs = (): number => {
  const raw = process.env.COSTRICT_REPO_SCAN_CACHE_TTL_MS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0) return parsed
  return 60_000
}

const isPathWithinRoot = (root: string, target: string): boolean => {
  const relative = path.relative(root, target)
  if (!relative) return true
  if (relative.startsWith('..')) return false
  return !path.isAbsolute(relative)
}

const resolveRepoScanRoots = (): string[] => {
  const raw = process.env.COSTRICT_REPO_SCAN_ROOTS
  const splitPattern = new RegExp(`[${path.delimiter},\\n\\r]`)
  const roots = raw
    ? raw
        .split(splitPattern)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [homedir()]

  const resolvedRoots = roots.map((entry) => path.resolve(entry))
  const current = process.cwd()
  if (!resolvedRoots.some((root) => isPathWithinRoot(root, current))) {
    resolvedRoots.push(current)
  }

  const uniqueRoots = Array.from(new Set(resolvedRoots))
  return uniqueRoots.filter((root) => {
    try {
      return statSync(root).isDirectory()
    } catch {
      return false
    }
  })
}

type RepoScanCacheEntry = {
  timestamp: number
  optionsKey: string
  roots: string[]
  maxDepth: number
  maxResults: number
  result: LocalRepoScanResult
}

let repoScanCache: RepoScanCacheEntry | null = null

const listLocalRepos = async (forceRefresh = false): Promise<RepoScanCacheEntry> => {
  const roots = resolveRepoScanRoots()
  const maxDepth = resolveRepoScanMaxDepth()
  const maxResults = resolveRepoScanMaxResults()
  const optionsKey = JSON.stringify({ roots, maxDepth, maxResults })
  const cacheTtlMs = resolveRepoScanCacheTtlMs()

  if (
    !forceRefresh &&
    repoScanCache &&
    repoScanCache.optionsKey === optionsKey &&
    Date.now() - repoScanCache.timestamp < cacheTtlMs
  ) {
    return repoScanCache
  }

  const result = roots.length
    ? await scanLocalGitRepos({ roots, maxDepth, maxResults })
    : { repos: [], truncated: false }

  repoScanCache = {
    timestamp: Date.now(),
    optionsKey,
    roots,
    maxDepth,
    maxResults,
    result,
  }

  return repoScanCache
}

type StreamedToolCall = {
  type?: string
  toolCallId?: string
  toolName?: string
  args: unknown
}

type StreamedToolResult = {
  type?: string
  toolCallId?: string
  toolName?: string
  args?: unknown
  result: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeToolNameKey = (rawName: string): string => {
  const trimmed = rawName.trim()
  if (!trimmed) return ''

  return trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

const isSubmitSummaryToolName = (toolName: unknown): boolean => {
  if (typeof toolName !== 'string') return false
  const normalized = normalizeToolNameKey(toolName)
  return normalized === 'submit_summary' || normalized === 'submitsummary'
}

const parseJsonIfString = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

const normalizeToolCall = (value: unknown): StreamedToolCall | null => {
  if (!isRecord(value)) return null

  const type = typeof value.type === 'string' ? value.type : undefined
  const toolCallId =
    typeof value.toolCallId === 'string'
      ? value.toolCallId
      : typeof value.id === 'string'
        ? value.id
        : undefined

  if ('toolName' in value || 'args' in value) {
    const toolName = typeof value.toolName === 'string' ? value.toolName : undefined
    const args = parseJsonIfString((value as { args?: unknown }).args)
    return { type, toolCallId, toolName, args }
  }

  const fn = value.function
  if (isRecord(fn)) {
    const toolName = typeof fn.name === 'string' ? fn.name : undefined
    const args = parseJsonIfString(fn.arguments)
    return { type, toolCallId, toolName, args }
  }

  return null
}

const normalizeToolCalls = (value: unknown): StreamedToolCall[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => normalizeToolCall(entry))
    .filter(Boolean) as StreamedToolCall[]
}

const normalizeToolResult = (value: unknown): StreamedToolResult | null => {
  if (!isRecord(value)) return null
  const type = typeof value.type === 'string' ? value.type : undefined
  const toolCallId =
    typeof value.toolCallId === 'string'
      ? value.toolCallId
      : typeof value.id === 'string'
        ? value.id
        : undefined
  const toolName = typeof value.toolName === 'string' ? value.toolName : undefined
  const args = parseJsonIfString((value as { args?: unknown }).args)
  const result = parseJsonIfString((value as { result?: unknown }).result)
  return { type, toolCallId, toolName, args, result }
}

const normalizeToolResults = (value: unknown): StreamedToolResult[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => normalizeToolResult(entry))
    .filter(Boolean) as StreamedToolResult[]
}

const extractReportFromArgs = (args: unknown): string | null => {
  const parsedArgs = parseJsonIfString(args)
  if (typeof parsedArgs === 'string') {
    const trimmed = parsedArgs.trim()
    return trimmed ? trimmed : null
  }
  if (!isRecord(parsedArgs)) return null
  const report = parsedArgs.report
  if (typeof report !== 'string') return null
  const trimmed = report.trim()
  return trimmed ? trimmed : null
}

const extractSubmitSummaryReport = (
  toolCalls: StreamedToolCall[],
  toolResults: StreamedToolResult[]
): string | null => {
  const callMatch = toolCalls.find((call) => isSubmitSummaryToolName(call.toolName))
  if (callMatch) {
    const extracted = extractReportFromArgs(callMatch.args)
    if (extracted) return extracted
  }

  const resultMatch = toolResults.find((result) =>
    isSubmitSummaryToolName(result.toolName)
  )
  if (resultMatch && 'args' in resultMatch) {
    const extracted = extractReportFromArgs(resultMatch.args)
    if (extracted) return extracted
  }

  return null
}

const containsBugKeywords = (text: string): boolean => {
  const lowered = text.toLowerCase()
  return (
    /\bbugs?\b/.test(lowered) ||
    /\bissues?\b/.test(lowered) ||
    /\berrors?\b/.test(lowered) ||
    lowered.includes('defect') ||
    lowered.includes('regression') ||
    lowered.includes('exception') ||
    lowered.includes('crash') ||
    text.includes('缺陷') ||
    text.includes('漏洞') ||
    text.includes('错误') ||
    text.includes('异常') ||
    text.includes('崩溃') ||
    text.includes('问题')
  )
}

const hasPlanningArtifacts = (text: string): boolean =>
  /总体规划|执行记录|计划调整|完成条件|\bDoD\b|^\s*P\d+\s*[:：]|\bsandbox_exec\b|approval|批准|等待|verification/im.test(
    text
  )

const isPlanningLine = (line: string): boolean => {
  const trimmed = line.trim()
  if (!trimmed) return false

  if (
    /总体规划|执行记录|计划调整|完成条件|\bDoD\b|收集项目上下文|变更文件|变更块|影响评估|验证策略|问题记录策略|sandbox_exec|approval|批准|等待|verification|verify/i.test(
      trimmed
    )
  ) {
    return true
  }

  if (/^\s*P\d+\s*[:：]/i.test(trimmed) || /^\s*DoD\d+/i.test(trimmed)) {
    return true
  }

  if (
    /\b(read_diff|read_file|ls|grep|glob|sandbox_exec|submit_summary|report_bug|suggest_change)\b/i.test(
      trimmed
    )
  ) {
    return true
  }

  return /^(分析|评估|检查|验证|使用|读取|运行|查看|确定|确认|等待|请求|需要)\b/.test(
    trimmed
  )
}

const stripPlanningContent = (text: string): string => {
  if (!hasPlanningArtifacts(text)) return text
  const filtered = text
    .split(/\r?\n/)
    .filter((line) => !isPlanningLine(line))
    .join('\n')
    .trim()
  return filtered
}

const isMetaSummary = (text: string): boolean => {
  const lowered = text.toLowerCase()
  if (!lowered.trim()) return true
  if (lowered.length < 120) {
    if (
      lowered.includes('approval') ||
      lowered.includes('sandbox_exec') ||
      lowered.includes('verification') ||
      lowered.includes('verify') ||
      lowered.includes('wait for') ||
      lowered.includes('awaiting')
    ) {
      return true
    }
  }
  return /等待.*批准|请求.*批准|需要.*批准|等待.*确认/.test(text)
}

const looksLikeBugNarrative = (text: string): boolean => {
  const lowered = text.toLowerCase()
  if (/`[^`]+`/.test(text)) return true
  if (/\b(line|lines|stack|trace|exception|crash|panic)\b/.test(lowered)) {
    return true
  }
  if (/\.(ts|tsx|js|jsx|py|rb|go|rs|java|cs|cpp|c)\b/.test(lowered)) {
    return true
  }
  if (
    /undefined|null|division by zero|divide by zero|overflow|deadlock|leak|timeout/.test(
      lowered
    )
  ) {
    return true
  }
  return /(?:返回|导致|出现|无法|错误|异常|崩溃|缺陷|漏洞)/.test(text)
}

const extractBugCandidates = (text: string): string[] => {
  const candidates = new Set<string>()
  const lines = text.split(/\r?\n/)

  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (!match?.[1]) continue
    const value = match[1].trim()
    if (!value) continue
    candidates.add(value)
  }

  if (candidates.size > 0) {
    return Array.from(candidates)
  }

  const oneLine = text.replace(/\s+/g, ' ').trim()
  const includeMatch =
    oneLine.match(/bugs? include (.+?)(?:\.|$)/i) ??
    oneLine.match(/issues? include (.+?)(?:\.|$)/i) ??
    oneLine.match(/(?:bugs?|issues?)[:：]\s*(.+?)(?:\.|$)/i) ??
    oneLine.match(/包括(.+?)(?:。|$)/)

  if (!includeMatch?.[1]) return []

  const normalized = includeMatch[1]
    .replace(/\s+and\s+/gi, ', ')
    .replace(/[以及和]/g, '、')
    .replace(/；/g, '、')
    .replace(/;/g, ',')
    .trim()

  return normalized
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const createSingleUseSandboxExecTool = (baseTool: Tool): Tool => {
  let used = false
  return tool({
    description: `${baseTool.description ?? 'Execute a bash command in a sandbox.'} (single use per bug)`,
    parameters: baseTool.parameters,
    execute: async (args, options) => {
      if (used) {
        return 'Duplicate sandbox_exec prevented: only one sandbox_exec run is allowed for this bug.'
      }
      used = true
      if (!baseTool.execute) {
        return 'sandbox_exec unavailable for this run.'
      }
      return baseTool.execute(args as never, options)
    },
  })
}

type SubAgentReport = {
  goal: string
  report: string
}

const subAgentGoals = [
  {
    goal: '[Static Analysis Agent] Scan changed code for syntax, type, and style risks.',
  },
  {
    goal: '[Logic Analysis Agent] Check control flow, edge cases, and logical correctness.',
  },
  {
    goal: '[Memory & Performance Agent] Review for performance hot spots and resource usage risks.',
  },
  {
    goal: '[Security Analysis Agent] Look for security risks, threat vectors, and unsafe patterns.',
  },
]

const truncateText = (value: string, maxLength = 2000): string => {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`
}

const formatSubAgentContext = (reports: SubAgentReport[]): string => {
  if (reports.length === 0) return ''
  const blocks = reports.map((report) => {
    const summary = summarizeSubAgentReportForContext(report.report)
    const trimmed = summary
      ? truncateText(summary.trim())
      : truncateText(report.report.trim())
    return `Goal: ${report.goal}\nReport:\n${trimmed}`
  })
  return `\n\nSub-agent reports (pre-run):\n${blocks.join('\n\n')}\n`
}

const resolveSubAgentPreflightConcurrency = (): number => {
  const raw = process.env.COSTRICT_SUBAGENT_PREFLIGHT_CONCURRENCY
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.min(parsed, 4)
  }
  return 4
}

const runSubAgentPreflight = async ({
  spawnTool,
  fileContext,
  safeWriteSSE,
}: {
  spawnTool: Tool
  fileContext: string
  safeWriteSSE: (payload: unknown) => Promise<boolean>
}): Promise<SubAgentReport[]> => {
  const fileNote = fileContext.trim() ? ` Focus on changed files: ${fileContext}.` : ''
  const goals = subAgentGoals.map((item) => `${item.goal}${fileNote}`)

  const toolCalls = goals.map((goal) => ({
    type: 'tool-call',
    toolCallId: crypto.randomUUID(),
    toolName: 'spawn_subagent',
    args: { goal },
  }))

  const executeCall = async (
    call: (typeof toolCalls)[number]
  ): Promise<SubAgentReport | null> => {
    const args: Record<string, unknown> = isRecord(call.args) ? call.args : {}
    const goal = typeof args.goal === 'string' ? args.goal : ''
    if (!goal) return null
    if (!spawnTool.execute) {
      return { goal, report: 'spawn_subagent unavailable for this run.' }
    }
    try {
      const raw = await spawnTool.execute(args as never, {
        toolCallId: call.toolCallId,
        messages: [],
      })
      const report =
        typeof raw === 'string' ? raw : raw === undefined ? '' : JSON.stringify(raw)
      return report ? { goal, report } : null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { goal, report: `Error executing sub-agent: ${message}` }
    }
  }

  const reports = new Array<SubAgentReport | null>(toolCalls.length).fill(null)
  const concurrency = Math.min(resolveSubAgentPreflightConcurrency(), toolCalls.length)

  if (concurrency <= 1) {
    for (const [index, call] of toolCalls.entries()) {
      reports[index] = await executeCall(call)
    }
  } else {
    let nextIndex = 0
    const workers = Array.from({ length: concurrency }).map(async () => {
      while (true) {
        const index = nextIndex
        nextIndex += 1
        if (index >= toolCalls.length) return
        reports[index] = await executeCall(toolCalls[index])
      }
    })
    await Promise.all(workers)
  }

  const toolResults = toolCalls.map((call, index) => ({
    type: 'tool-result',
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    args: call.args,
    result: reports[index]?.report ?? '',
  }))

  const ok = await safeWriteSSE({
    type: 'step',
    step: {
      toolCalls,
      toolResults,
      text: '',
      usage: undefined,
    },
  })
  if (!ok) {
    throw new Error('Client disconnected.')
  }

  return reports.filter((report): report is SubAgentReport => Boolean(report?.report))
}

const inferSeverity = (text: string): 'low' | 'medium' | 'high' | 'critical' => {
  const lowered = text.toLowerCase()
  if (
    lowered.includes('rce') ||
    lowered.includes('remote code') ||
    text.includes('RCE')
  ) {
    return 'critical'
  }
  if (
    lowered.includes('crash') ||
    lowered.includes('panic') ||
    lowered.includes('exception') ||
    text.includes('崩溃') ||
    text.includes('异常')
  ) {
    return 'high'
  }
  if (
    lowered.includes('security') ||
    lowered.includes('injection') ||
    text.includes('漏洞') ||
    text.includes('注入')
  ) {
    return 'high'
  }
  return 'medium'
}

const waitForSandboxDecision = (
  requestId: string,
  timeoutMs = 120_000
): Promise<SandboxExecApprovalResponse> => {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      sandboxWaiters.delete(requestId)
      resolve({ approved: false, reason: 'User approval timed out.' })
    }, timeoutMs)

    sandboxWaiters.set(requestId, {
      resolve: (response) => {
        clearTimeout(timeout)
        sandboxWaiters.delete(requestId)
        resolve(response)
      },
    })
  })
}

app.use('/*', cors())

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.get('/api/llm/effective', async (c) => {
  const run = async () => {
    const fileCreds = await loadLlmCredentials()
    const resolved = await resolveLlmCredentials()

    const envApiKey = process.env.OPENAI_API_KEY
    const envBaseUrl = process.env.OPENAI_API_BASE

    const envApiKeyNormalized = envApiKey?.trim() || undefined
    const envBaseUrlNormalized = normalizeBaseUrl(envBaseUrl)

    const apiKeySource = envApiKeyNormalized
      ? 'env'
      : fileCreds.openaiApiKey
        ? 'file'
        : 'missing'
    const baseUrlSource = envBaseUrlNormalized
      ? 'env'
      : fileCreds.openaiApiBase
        ? 'file'
        : 'missing'

    const apiKey = resolved.openaiApiKey
    const baseUrl = resolved.openaiApiBase

    return c.json({
      baseUrl: baseUrl ?? '',
      baseUrlSource,
      apiKeyMasked: apiKey ? maskApiKey(apiKey) : '',
      apiKeySource,
      hasApiKey: Boolean(apiKey),
    })
  }

  const url = new URL(c.req.url, 'http://localhost')
  const repoPath = url.searchParams.get('repoPath')?.trim()
  if (repoPath) {
    try {
      const workspaceRoot = await resolveGitRootFromPath(repoPath)
      return await withWorkspaceRoot(workspaceRoot, run)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`Ignoring invalid repo path for effective config: ${message}`)
    }
  }

  return run()
})

app.get('/api/local/repos', async (c) => {
  const url = new URL(c.req.url, 'http://localhost')
  const forceRefresh = url.searchParams.get('refresh') === '1'

  try {
    const scan = await listLocalRepos(forceRefresh)
    let currentRepo: string | undefined

    try {
      currentRepo = await resolveGitRootFromPath(process.cwd())
    } catch {
      currentRepo = undefined
    }

    return c.json({
      repos: scan.result.repos,
      truncated: scan.result.truncated,
      roots: scan.roots,
      maxDepth: scan.maxDepth,
      maxResults: scan.maxResults,
      current: currentRepo ?? '',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to scan local repos: ${message}`)
    return c.json({ repos: [], truncated: false, message }, 500)
  }
})

app.get('/api/github/oauth/start', async (c) => {
  const renderOauthErrorPage = (origin: string, message: string) => {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub Login Error</title>
  </head>
  <body style="font-family: ui-sans-serif, system-ui; padding: 24px; background: #05060a; color: #e2e8f0;">
    <h1 style="margin: 0 0 12px; font-size: 18px;">GitHub login unavailable</h1>
    <p style="margin: 0 0 16px; color: #94a3b8;">${message}</p>
    <p style="margin: 0 0 16px; color: #94a3b8;">You can close this window.</p>
    <script>
      (function () {
        var payload = { type: 'github_oauth_error', message: ${JSON.stringify(message)} };
        var targetOrigin = ${JSON.stringify(origin)};
        try {
          if (window.opener) {
            window.opener.postMessage(payload, targetOrigin);
          }
        } catch (error) {
          console.error(error);
        }
        try { window.close(); } catch (error) {}
      })();
    </script>
  </body>
</html>`

    return c.html(html, 500)
  }

  const requestUrl = new URL(c.req.url, 'http://localhost')
  const originParam = requestUrl.searchParams.get('origin')?.trim()
  const refererHeader = c.req.header('referer')?.trim()
  let refererOrigin: string | undefined
  if (refererHeader) {
    try {
      refererOrigin = new URL(refererHeader).origin
    } catch {
      refererOrigin = undefined
    }
  }
  const origin = originParam || refererOrigin || new URL(c.req.url).origin

  const clientId = resolveGitHubOAuthClientId()
  if (!clientId) {
    return renderOauthErrorPage(
      origin,
      'GitHub OAuth is not configured. Set COSTRICT_GITHUB_OAUTH_CLIENT_ID and COSTRICT_GITHUB_OAUTH_CLIENT_SECRET, set GITHUB_TOKEN, or login with GitHub CLI (gh auth login).'
    )
  }

  cleanupGitHubOauthStates()

  const apiOrigin = new URL(c.req.url).origin
  const redirectUri = resolveGitHubOAuthRedirectUri(apiOrigin)

  const state = crypto.randomUUID()
  githubOauthStates.set(state, { origin, createdAt: Date.now() })

  const authorizeUrl = new URL('https://github.com/login/oauth/authorize')
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('scope', 'public_repo')
  authorizeUrl.searchParams.set('state', state)

  return c.redirect(authorizeUrl.toString())
})

app.get('/api/github/oauth/callback', async (c) => {
  const requestUrl = new URL(c.req.url, 'http://localhost')
  const code = requestUrl.searchParams.get('code')?.trim() ?? ''
  const state = requestUrl.searchParams.get('state')?.trim() ?? ''

  if (!code) {
    return c.text('Missing OAuth code.', 400)
  }
  if (!state) {
    return c.text('Missing OAuth state.', 400)
  }

  const stateEntry = githubOauthStates.get(state)
  if (!stateEntry) {
    return c.text('Invalid or expired OAuth state.', 400)
  }
  githubOauthStates.delete(state)

  const renderOauthCallbackErrorPage = (origin: string, message: string) => {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub Login Error</title>
  </head>
  <body style="font-family: ui-sans-serif, system-ui; padding: 24px; background: #05060a; color: #e2e8f0;">
    <h1 style="margin: 0 0 12px; font-size: 18px;">GitHub login failed</h1>
    <p style="margin: 0 0 16px; color: #94a3b8;">${message}</p>
    <p style="margin: 0 0 16px; color: #94a3b8;">You can close this window.</p>
    <script>
      (function () {
        var payload = { type: 'github_oauth_error', message: ${JSON.stringify(message)} };
        var targetOrigin = ${JSON.stringify(origin)};
        try {
          if (window.opener) {
            window.opener.postMessage(payload, targetOrigin);
          }
        } catch (error) {
          console.error(error);
        }
        try { window.close(); } catch (error) {}
      })();
    </script>
  </body>
</html>`

    return c.html(html, 500)
  }

  const clientId = resolveGitHubOAuthClientId()
  const clientSecret = resolveGitHubOAuthClientSecret()
  if (!clientId || !clientSecret) {
    return renderOauthCallbackErrorPage(
      stateEntry.origin,
      'GitHub OAuth is not configured. Set COSTRICT_GITHUB_OAUTH_CLIENT_ID and COSTRICT_GITHUB_OAUTH_CLIENT_SECRET, set GITHUB_TOKEN, or login with GitHub CLI (gh auth login).'
    )
  }

  const apiOrigin = new URL(c.req.url).origin
  const redirectUri = resolveGitHubOAuthRedirectUri(apiOrigin)

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'costrict-web',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })

  const tokenData = (await tokenResponse.json().catch(() => null)) as null | {
    access_token?: unknown
    error?: unknown
    error_description?: unknown
  }

  const accessToken =
    tokenData && typeof tokenData.access_token === 'string' ? tokenData.access_token : ''

  if (!tokenResponse.ok || !accessToken) {
    const err =
      tokenData && typeof tokenData.error_description === 'string'
        ? tokenData.error_description
        : tokenData && typeof tokenData.error === 'string'
          ? tokenData.error
          : 'OAuth token exchange failed.'
    return renderOauthCallbackErrorPage(stateEntry.origin, err)
  }

  const origin = stateEntry.origin

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub Login</title>
  </head>
  <body style="font-family: ui-sans-serif, system-ui; padding: 24px; background: #05060a; color: #e2e8f0;">
    <h1 style="margin: 0 0 12px; font-size: 18px;">GitHub login complete</h1>
    <p style="margin: 0 0 16px; color: #94a3b8;">You can close this window.</p>
    <script>
      (function () {
        var token = ${JSON.stringify(accessToken)};
        var targetOrigin = ${JSON.stringify(origin)};
        try {
          if (window.opener && token) {
            window.opener.postMessage({ type: 'github_oauth_token', token: token }, targetOrigin);
          }
        } catch (error) {
          console.error(error);
        }
        try { window.close(); } catch (error) {}
      })();
    </script>
  </body>
</html>`

  return c.html(html)
})

app.post('/api/github/pr/comment', async (c) => {
  const authorization = c.req.header('authorization')?.trim() ?? ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  let token = match?.[1]?.trim() ?? ''
  if (!token) {
    token = process.env.GITHUB_TOKEN?.trim() ?? ''
  }
  if (!token) {
    token = await resolveGitHubTokenFromGh()
  }
  if (!token) {
    return c.json(
      {
        message:
          'Missing GitHub access token. Configure GitHub OAuth (COSTRICT_GITHUB_OAUTH_CLIENT_ID/COSTRICT_GITHUB_OAUTH_CLIENT_SECRET), set GITHUB_TOKEN, or login with GitHub CLI (gh auth login).',
      },
      401
    )
  }

  const body = await c.req.json()
  const rawPrUrl = typeof body.githubPrUrl === 'string' ? body.githubPrUrl.trim() : ''
  const comment = typeof body.comment === 'string' ? body.comment.trim() : ''

  if (!rawPrUrl) {
    return c.json({ message: 'Missing GitHub PR URL.' }, 400)
  }
  if (!comment) {
    return c.json({ message: 'Missing comment body.' }, 400)
  }

  const pullRequest = parseGitHubPullRequestUrl(rawPrUrl)
  if (!pullRequest) {
    return c.json({ message: `Invalid GitHub PR URL: ${rawPrUrl}` }, 400)
  }

  const truncated =
    comment.length > 60_000
      ? `${comment.slice(0, 59_999)}…\n\n(Truncated to fit GitHub comment limits.)`
      : comment

  try {
    const octokit = new Octokit({ auth: token })
    const response = await octokit.rest.issues.createComment({
      owner: pullRequest.owner,
      repo: pullRequest.repo,
      issue_number: pullRequest.number,
      body: truncated,
    })

    return c.json({ url: response.data.html_url ?? '' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to post GitHub PR comment: ${message}`)
    return c.json({ message: `Failed to post GitHub PR comment: ${message}` }, 500)
  }
})

app.post('/api/sandbox/decision', async (c) => {
  const { requestId, approved } = await c.req.json()
  const waiter = sandboxWaiters.get(requestId)

  if (!waiter) {
    return c.json({ ok: false, message: 'Unknown sandbox request.' }, 404)
  }

  waiter.resolve({
    approved: Boolean(approved),
    reason: approved ? undefined : 'User denied sandbox execution.',
  })

  return c.json({ ok: true })
})

app.post('/api/review', async (c) => {
  const body = await c.req.json()
  const {
    modelString = 'openai:gpt-5.2',
    maxSteps = 25,
    reviewLanguage = 'English',
    apiKey,
    baseUrl,
    repoPath,
    githubPrUrl,
    githubToken,
    environment,
  } = body

  const trimmedBaseUrl =
    typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/$/, '') : undefined
  const trimmedApiKey = typeof apiKey === 'string' ? apiKey.trim() : undefined
  const trimmedGitHubTokenFromBody =
    typeof githubToken === 'string' ? githubToken.trim() : ''
  let trimmedGitHubToken =
    trimmedGitHubTokenFromBody || process.env.GITHUB_TOKEN?.trim() || ''
  const rawEnvironment = typeof environment === 'string' ? environment.trim() : ''

  let effectiveBaseUrl: string | undefined
  let effectiveApiKey: string | undefined
  const rawRepoPath = typeof repoPath === 'string' ? repoPath.trim() : ''
  const rawGitHubPrUrl = typeof githubPrUrl === 'string' ? githubPrUrl.trim() : ''
  const gitHubPullRequest = rawGitHubPrUrl
    ? parseGitHubPullRequestUrl(rawGitHubPrUrl)
    : null
  const gitHubPullRequestUrl = gitHubPullRequest
    ? toGitHubPullRequestUrl(gitHubPullRequest)
    : null

  const wantsGitHubReview =
    rawEnvironment === PlatformOptions.GITHUB || Boolean(rawGitHubPrUrl)

  if (wantsGitHubReview && !rawGitHubPrUrl) {
    return c.json({ message: 'GitHub PR URL is required.' }, 400)
  }

  if (rawGitHubPrUrl && !gitHubPullRequest) {
    return c.json({ message: `Invalid GitHub PR URL: ${rawGitHubPrUrl}` }, 400)
  }

  let localWorkspaceRoot: string | undefined
  if (!wantsGitHubReview && rawRepoPath) {
    const resolvedPath = path.resolve(rawRepoPath)
    if (!existsSync(resolvedPath)) {
      return c.json({ message: `Repo path not found: ${resolvedPath}` }, 400)
    }
    try {
      const stat = statSync(resolvedPath)
      if (!stat.isDirectory()) {
        return c.json({ message: `Repo path must be a directory: ${resolvedPath}` }, 400)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ message: `Failed to inspect repo path: ${message}` }, 400)
    }

    try {
      localWorkspaceRoot = await resolveGitRootFromPath(resolvedPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ message: `Repo path is not a git repository: ${message}` }, 400)
    }
  }

  return streamSSE(c, async (stream) => {
    const runReview = async () => {
      let clients: MCPClientManager | null = null
      let heartbeat: ReturnType<typeof setInterval> | null = null

      let sseWriteQueue: Promise<boolean> = Promise.resolve(true)
      let sseDisconnected = false

      const safeWriteSSE = (data: unknown): Promise<boolean> => {
        if (sseDisconnected) {
          return Promise.resolve(false)
        }

        const payload = JSON.stringify(data)
        sseWriteQueue = sseWriteQueue.then(async () => {
          if (sseDisconnected) return false
          try {
            await stream.writeSSE({ data: payload })
            return true
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            sseDisconnected = true
            logger.warn(`SSE write failed (client likely disconnected): ${message}`)
            return false
          }
        })

        return sseWriteQueue
      }

      const startHeartbeat = () => {
        // Keep the SSE connection alive through proxies that enforce idle timeouts.
        heartbeat = setInterval(() => {
          safeWriteSSE({ type: 'ping', timestamp: Date.now() }).catch(() => {
            // Ignore failures; safeWriteSSE already logs.
          })
        }, resolveSsePingIntervalMs())
      }

      const stopHeartbeat = () => {
        if (heartbeat) {
          clearInterval(heartbeat)
          heartbeat = null
        }
      }

      try {
        startHeartbeat()

        if (localWorkspaceRoot) {
          await safeWriteSSE({
            type: 'status',
            message: `Using local repo: ${localWorkspaceRoot}`,
          })
        }

        const credentials = await resolveLlmCredentials()
        effectiveBaseUrl = trimmedBaseUrl || credentials.openaiApiBase
        effectiveApiKey = trimmedApiKey || credentials.openaiApiKey

        await safeWriteSSE({ type: 'status', message: 'Initializing review...' })

        // 1. Get Files
        const platformOption = wantsGitHubReview
          ? PlatformOptions.GITHUB
          : PlatformOptions.LOCAL
        const platformProvider = createWebProvider(platformOption)
        logger.debug('Getting files with changes...')
        const files = await getFilesWithChanges(platformOption)
        logger.debug(`Found ${files.length} files`)

        if (files.length === 0) {
          logger.debug('No files found, returning error')
          await safeWriteSSE({
            type: 'error',
            message: 'No changed files found. Please stage some changes.',
          })
          return
        }

        await safeWriteSSE({
          type: 'files',
          files: files.map((f) => f.fileName),
        })

        // 2. Filter Files
        const filteredFiles = filterFiles(files, []) // TODO: Add ignore support

        // 3. Construct Prompt
        let prompt = await constructPrompt(filteredFiles, reviewLanguage)

        // 4. Setup Model & Tools
        const model = createModel(modelString, {
          baseURL: effectiveBaseUrl,
          apiKey: effectiveApiKey,
        })

        clients = new MCPClientManager()
        await clients.loadConfig()
        await clients.startClients()

        const sandboxConfirm = async ({
          command,
          cwd,
          timeout,
          toolCallId,
        }: {
          command: string
          cwd: string
          timeout: number
          toolCallId?: string
        }): Promise<SandboxExecApprovalResponse> => {
          const requestId = crypto.randomUUID()

          const ok = await safeWriteSSE({
            type: 'sandbox_request',
            requestId,
            toolCallId,
            command,
            cwd,
            timeout,
          })
          if (!ok) {
            return { approved: false, reason: 'Client disconnected.' }
          }

          return waitForSandboxDecision(requestId, timeout + 60_000)
        }

        const sandboxOnEvent: SandboxExecOnEvent = (event) => {
          void safeWriteSSE(event)
        }

        const tools = await getAllTools({
          platformProvider,
          model,
          mcpClientManager: clients,
          includeSubAgent: true,
          maxSteps,
          sandboxConfirm,
          sandboxOnEvent,
        })

        // 5. Run Agent
        await safeWriteSSE({ type: 'status', message: 'Agent started...' })

        const subAgentCache = new Map<string, string>()
        if (tools.spawn_subagent) {
          try {
            await safeWriteSSE({
              type: 'status',
              message: 'Spawning sub-agents...',
            })

            const started = await safeWriteSSE({
              type: 'subagent_preflight',
              state: 'start',
              total: subAgentGoals.length,
            })
            if (!started) {
              throw new Error('Client disconnected.')
            }

            let reports: SubAgentReport[] = []
            let preflightError: unknown | null = null
            let endedOk = true
            try {
              reports = await runSubAgentPreflight({
                spawnTool: tools.spawn_subagent,
                fileContext: filteredFiles.map((file) => file.fileName).join(', '),
                safeWriteSSE,
              })
            } catch (error) {
              preflightError = error
            } finally {
              endedOk = await safeWriteSSE({
                type: 'subagent_preflight',
                state: 'end',
              })
            }

            if (!endedOk) {
              throw new Error('Client disconnected.')
            }
            if (preflightError !== null) {
              throw preflightError
            }

            for (const report of reports) {
              subAgentCache.set(report.goal, report.report)
            }

            if (reports.length > 0) {
              prompt = `${prompt}${formatSubAgentContext(reports)}`
              tools.spawn_subagent = createCachedSubAgentTool(
                tools.spawn_subagent,
                subAgentCache
              )
              await safeWriteSSE({
                type: 'status',
                message: 'Sub-agents ready. Continuing review...',
              })
            } else {
              await safeWriteSSE({
                type: 'status',
                message:
                  'Sub-agent preflight did not return reports. Continuing review...',
              })
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (message === 'Client disconnected.') {
              throw error
            }
            logger.warn(`Sub-agent preflight failed: ${message}`)
            await safeWriteSSE({
              type: 'status',
              message: `Sub-agent preflight failed: ${message}`,
            })
          }
        }

        const sandboxExecRepeatLimit = resolveSandboxExecRepeatLimit()
        const sandboxExecCounts = new Map<string, number>()
        const sandboxExecKeyByToolCallId = new Map<string, string>()
        const sandboxExecEvidenceByKey = new Map<string, string>()
        let sandboxLoopKey: string | null = null
        let sandboxOnlySignature: string | null = null
        let sandboxOnlyRepeats = 0
        const abortController = new AbortController()

        let submittedReport: string | null = null
        let sawReportBug = false

        const emitBugCardsIfNeeded = async (
          reportText: string,
          alreadySawReportBug: boolean
        ) => {
          const sanitizedReportText = stripPlanningContent(reportText)
          if (
            alreadySawReportBug ||
            !sanitizedReportText ||
            isMetaSummary(sanitizedReportText) ||
            !containsBugKeywords(sanitizedReportText)
          ) {
            return
          }

          await safeWriteSSE({
            type: 'status',
            message: 'Recording bug cards (report_bug) from the review summary...',
          })

          let bugCardsEmitted = false

          const streamBugStep = async (step: {
            toolCalls: unknown
            toolResults?: unknown
            text: unknown
            usage: unknown
          }) => {
            const toolCalls = normalizeToolCalls(step.toolCalls)
            const toolResults = normalizeToolResults(step.toolResults)
            if (!bugCardsEmitted) {
              bugCardsEmitted = toolCalls.some(
                (call) =>
                  typeof call.toolName === 'string' &&
                  normalizeToolNameKey(call.toolName) === 'report_bug'
              )
            }

            const ok = await safeWriteSSE({
              type: 'step',
              step: {
                toolCalls,
                toolResults,
                text:
                  typeof step.text === 'string'
                    ? stripProviderJsonFromText(step.text)
                    : '',
                usage: step.usage,
              },
            })
            if (!ok) {
              throw new Error('Client disconnected.')
            }
          }

          const candidates = extractBugCandidates(sanitizedReportText).slice(0, 10)
          if (candidates.length === 0 && !looksLikeBugNarrative(sanitizedReportText)) {
            return
          }

          const verifyAndReportSingleBug = async (candidate: string) => {
            const bugPrompt = `You previously completed a PR review.

  Task (MANDATORY):
  - You are handling ONE bug candidate (below).
  - You MUST attempt to verify it via sandbox_exec.
  - The system handles user approval automatically when you call the tool. Do NOT ask for confirmation in text. Just call the tool.
  - Run EXACTLY ONE sandbox_exec command for this bug. Do NOT loop or retry the same command.
  - After sandbox_exec (or if denied / infeasible), call report_bug EXACTLY ONCE for this bug.
  - Set status VERIFIED only if sandbox output demonstrates the bug; otherwise UNVERIFIED with the reason.
  - Do NOT call submit_summary.
  - Do NOT output long narrative text. Prefer tool calls only.
  - Even if multiple bugs could share the same command, DO NOT reuse one sandbox_exec run for multiple bug cards. This bug needs its own sandbox_exec attempt and its own report_bug card.
  - Ignore any planning/checklist content in the context summary.
  - Use sandbox_exec ONLY for a minimal reproduction or verification command (do not use it for ls/cat/git diff or context gathering).

  Bug candidate:
  ${candidate}

  Context summary:
  ${sanitizedReportText}
  `

            await reviewAgent(
              bugPrompt,
              model,
              Math.min(maxSteps, 6),
              {
                sandbox_exec: createSingleUseSandboxExecTool(tools.sandbox_exec),
                report_bug: tools.report_bug,
              },
              undefined,
              streamBugStep
            )
          }

          try {
            if (candidates.length > 0) {
              for (const candidate of candidates) {
                const trimmed = candidate.trim()
                if (!trimmed) continue
                await safeWriteSSE({
                  type: 'status',
                  message: `Verifying bug in sandbox: ${trimmed}`,
                })
                await verifyAndReportSingleBug(trimmed)
              }
            } else {
              const fallbackPrompt = `You previously completed a PR review.

  Task (MANDATORY):
  - Extract each distinct bug mentioned in the summary below.
  - For EACH bug: attempt ONE sandbox_exec verification, then call report_bug EXACTLY ONCE.
  - Do NOT call submit_summary.
  - Do NOT output long narrative text. Prefer tool calls only.
  - Ignore any planning/checklist content in the summary.
  - Use sandbox_exec only for minimal verification commands; do not use it for ls/cat/git diff or context gathering.

  Summary to extract from:
  ${sanitizedReportText}
  `

              await reviewAgent(
                fallbackPrompt,
                model,
                Math.min(maxSteps, 10),
                { sandbox_exec: tools.sandbox_exec, report_bug: tools.report_bug },
                undefined,
                streamBugStep
              )
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.warn(`Bug card extraction pass failed: ${message}`)
            await safeWriteSSE({
              type: 'status',
              message: `Bug card extraction pass failed: ${message}`,
            })
          }

          if (!bugCardsEmitted) {
            if (candidates.length > 0) {
              await safeWriteSSE({
                type: 'status',
                message: 'Auto-extracting bug cards from summary (heuristic fallback)...',
              })
            } else {
              await safeWriteSSE({
                type: 'status',
                message:
                  'No structured bug cards were emitted and no bug list could be extracted from the summary.',
              })
            }

            for (const candidate of candidates) {
              const toolCallId = `bug-${crypto.randomUUID()}`
              const title =
                candidate.length > 90 ? `${candidate.slice(0, 89)}…` : candidate
              const args = {
                title,
                description: `**Auto-extracted from review summary (fallback).**\n\n${candidate}`,
                status: 'UNVERIFIED',
                severity: inferSeverity(candidate),
                reproduction:
                  'Run sandbox_exec with a minimal reproduction command to confirm (requires user approval).',
                evidence: candidate,
              }

              const ok = await safeWriteSSE({
                type: 'step',
                step: {
                  toolCalls: [
                    {
                      type: 'tool-call',
                      toolCallId,
                      toolName: 'report_bug',
                      args,
                    },
                  ],
                  toolResults: [
                    {
                      type: 'tool-result',
                      toolCallId,
                      toolName: 'report_bug',
                      result: 'Bug recorded.',
                    },
                  ],
                  text: '',
                  usage: undefined,
                },
              })

              if (!ok) {
                throw new Error('Client disconnected.')
              }
            }
          }
        }

        const runRecoverySummary = async (reason: string, evidenceKey?: string) => {
          const evidence = evidenceKey
            ? sandboxExecEvidenceByKey.get(evidenceKey)
            : undefined
          const evidenceSection = evidence
            ? `Sandbox evidence (most recent successful run):\n\n${evidence}\n`
            : 'Sandbox evidence was not captured.\n'

          const fileSections = filteredFiles
            .map((file) => {
              const content =
                file.fileContent.length > 4000
                  ? `${file.fileContent.slice(0, 4000)}\n\n... (truncated)`
                  : file.fileContent
              return `File: ${file.fileName}\n\n\`\`\`\n${content}\n\`\`\`\n`
            })
            .join('\n')

          const recoveryPrompt = `You are completing a pull request review.

  Reason: ${reason}

  Tools are NOT available now.

  ${evidenceSection}

  ${fileSections}

  Task:
  - Write a concise, actionable review summary in ${reviewLanguage}.
  - Mention sandbox evidence (if present) and explain impact.
  - Do not output raw JSON or tool-call blobs.
  `

          const recovery = await generateText({
            model,
            prompt: recoveryPrompt,
            maxSteps: 1,
          })
          const recoveredText = stripProviderJsonFromText(recovery.text ?? '').trim()
          const finalReportText =
            recoveredText ||
            `Review completed, but the model did not produce a summary. (${reason})`

          try {
            const posted = await platformProvider.postThreadComment({
              comment: finalReportText,
            })
            const toolCallId = `submit-${crypto.randomUUID()}`
            await safeWriteSSE({
              type: 'step',
              step: {
                toolCalls: [
                  {
                    type: 'tool-call',
                    toolCallId,
                    toolName: 'submit_summary',
                    args: { report: finalReportText },
                  },
                ],
                toolResults: [
                  {
                    type: 'tool-result',
                    toolCallId,
                    toolName: 'submit_summary',
                    result: posted
                      ? `Report posted successfully: ${posted}`
                      : 'Report posted.',
                  },
                ],
                text: '',
                usage: undefined,
              },
            })
          } catch (postError) {
            const message =
              postError instanceof Error ? postError.message : String(postError)
            logger.warn(`Failed to post recovery report: ${message}`)
            await safeWriteSSE({
              type: 'status',
              message: `Failed to post recovery report: ${message}`,
            })
          }

          return finalReportText
        }

        const resolveMostRepeatedSandboxExecKey = (): string | null => {
          let bestKey: string | null = null
          let bestCount = 0

          for (const [key, count] of sandboxExecCounts) {
            if (count > bestCount) {
              bestCount = count
              bestKey = key
            }
          }

          return bestKey
        }

        let result: Awaited<ReturnType<typeof reviewAgent>> | null = null
        try {
          result = await reviewAgent(
            prompt,
            model,
            maxSteps,
            tools,
            () => {
              // Summary submitted callback
            },
            async (step) => {
              const toolCalls = normalizeToolCalls(step.toolCalls)
              const toolResults = normalizeToolResults(step.toolResults)

              const sandboxKeysInStep: string[] = []
              let sawNonSandboxToolCall = false

              for (const call of toolCalls) {
                if (typeof call.toolName !== 'string') continue
                const normalizedName = normalizeToolNameKey(call.toolName)
                if (normalizedName !== 'sandbox_exec') {
                  sawNonSandboxToolCall = true
                  continue
                }
                if (typeof call.toolCallId !== 'string') continue

                const args = isRecord(call.args) ? call.args : {}
                const command = typeof args.command === 'string' ? args.command : ''
                const cwd = typeof args.cwd === 'string' ? args.cwd : '.'
                const timeout =
                  typeof args.timeout === 'number'
                    ? String(args.timeout)
                    : 'unknown-timeout'
                const key = `${cwd}\n${timeout}\n${command}`

                sandboxExecKeyByToolCallId.set(call.toolCallId, key)
                sandboxExecCounts.set(key, (sandboxExecCounts.get(key) ?? 0) + 1)
                sandboxKeysInStep.push(key)
              }

              if (sandboxKeysInStep.length > 0 && !sawNonSandboxToolCall) {
                const signature = sandboxKeysInStep.join('\n---\n')
                if (signature === sandboxOnlySignature) {
                  sandboxOnlyRepeats += 1
                } else {
                  sandboxOnlySignature = signature
                  sandboxOnlyRepeats = 1
                }

                if (
                  !sandboxLoopKey &&
                  sandboxOnlyRepeats >= sandboxExecRepeatLimit &&
                  !submittedReport
                ) {
                  sandboxLoopKey = sandboxKeysInStep[0] ?? signature
                  await safeWriteSSE({
                    type: 'status',
                    message:
                      'Detected repeated sandbox_exec-only steps with the same command(s). Aborting the stuck run and generating a recovery summary...',
                  })
                  abortController.abort(
                    new Error('sandbox_exec loop detected (repeated sandbox-only steps)')
                  )
                }
              } else {
                sandboxOnlySignature = null
                sandboxOnlyRepeats = 0
              }

              for (const toolResult of toolResults) {
                if (typeof toolResult.toolCallId !== 'string') continue
                const key = sandboxExecKeyByToolCallId.get(toolResult.toolCallId)
                if (!key) continue
                if (sandboxExecEvidenceByKey.has(key)) continue
                if (typeof toolResult.result !== 'string') continue
                if (toolResult.result.startsWith('Duplicate sandbox_exec prevented'))
                  continue
                sandboxExecEvidenceByKey.set(key, toolResult.result)
              }

              if (!sawReportBug) {
                sawReportBug = toolCalls.some(
                  (call) =>
                    typeof call.toolName === 'string' &&
                    normalizeToolNameKey(call.toolName) === 'report_bug'
                )
              }

              const reportValue = extractSubmitSummaryReport(toolCalls, toolResults)
              if (reportValue) submittedReport = reportValue

              // Stream step
              const ok = await safeWriteSSE({
                type: 'step',
                step: {
                  toolCalls,
                  toolResults,
                  text:
                    typeof step.text === 'string'
                      ? stripProviderJsonFromText(step.text)
                      : '',
                  usage: step.usage,
                },
              })
              if (!ok) {
                // Stop work if the client is gone; prevents throwing and tearing down the response.
                throw new Error('Client disconnected.')
              }
            },
            abortController.signal
          )
        } catch (error) {
          if (sandboxLoopKey && abortController.signal.aborted) {
            const finalReportText = await runRecoverySummary(
              'sandbox_exec loop detected during review execution.',
              sandboxLoopKey
            )

            await emitBugCardsIfNeeded(finalReportText, false)

            await safeWriteSSE({
              type: 'complete',
              result: finalReportText,
            })
            return
          }

          throw error
        }

        if (!result) {
          throw new Error('Review agent did not return a result.')
        }

        if (!submittedReport) {
          const steps = (result as unknown as { steps?: unknown }).steps
          if (Array.isArray(steps)) {
            for (const step of steps) {
              const toolCalls = normalizeToolCalls(
                (step as { toolCalls?: unknown }).toolCalls
              )
              const toolResults = normalizeToolResults(
                (step as { toolResults?: unknown }).toolResults
              )
              const reportValue = extractSubmitSummaryReport(toolCalls, toolResults)
              if (reportValue) {
                submittedReport = reportValue
                break
              }
            }
          }
        }

        let finalReportText =
          submittedReport ?? stripProviderJsonFromText(result.text ?? '')
        if (finalReportText.trim() && isMetaSummary(finalReportText)) {
          finalReportText = await runRecoverySummary(
            'model produced a non-actionable meta summary.',
            resolveMostRepeatedSandboxExecKey() ?? undefined
          )
        }
        if (!finalReportText.trim()) {
          finalReportText = await runRecoverySummary(
            'model did not produce submit_summary or any final text.',
            resolveMostRepeatedSandboxExecKey() ?? undefined
          )
        }

        await emitBugCardsIfNeeded(finalReportText, sawReportBug)

        // Final result
        await safeWriteSSE({
          type: 'complete',
          result: finalReportText,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const cause =
          error instanceof Error
            ? (error as Error & { cause?: unknown }).cause
            : undefined
        const causeMessage =
          cause instanceof Error ? cause.message : cause ? String(cause) : undefined
        const fullMessage = [
          message,
          causeMessage ? `Cause: ${causeMessage}` : null,
          effectiveBaseUrl ? `Base URL: ${effectiveBaseUrl}` : null,
          modelString ? `Model: ${modelString}` : null,
        ]
          .filter(Boolean)
          .join(' | ')

        logger.error(`Review failed: ${fullMessage}`)
        if (error instanceof Error && error.stack) {
          logger.debug(error.stack)
        }
        await safeWriteSSE({
          type: 'error',
          message: fullMessage,
        })
      } finally {
        stopHeartbeat()
        if (clients) {
          try {
            await clients.closeClients()
          } catch (error) {
            logger.warn(`Failed to close MCP clients: ${String(error)}`)
          }
        }
      }
    }

    const runWithWorkspace = async () => {
      let checkout: Awaited<ReturnType<typeof checkoutGitHubPullRequest>> | null = null
      let reviewWorkspaceRoot = localWorkspaceRoot
      let githubEnv: Parameters<typeof withGitHubEnvVariables>[0] | null = null

      let preflightWriteQueue: Promise<boolean> = Promise.resolve(true)
      let preflightDisconnected = false
      let preflightHeartbeat: ReturnType<typeof setInterval> | null = null

      const preflightWriteSSE = (data: unknown): Promise<boolean> => {
        if (preflightDisconnected) {
          return Promise.resolve(false)
        }

        const payload = JSON.stringify(data)
        preflightWriteQueue = preflightWriteQueue.then(async () => {
          if (preflightDisconnected) return false
          try {
            await stream.writeSSE({ data: payload })
            return true
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            preflightDisconnected = true
            logger.warn(
              `SSE preflight write failed (client likely disconnected): ${message}`
            )
            return false
          }
        })

        return preflightWriteQueue
      }

      const startPreflightHeartbeat = () => {
        preflightHeartbeat = setInterval(() => {
          preflightWriteSSE({ type: 'ping', timestamp: Date.now() }).catch(() => {
            // Ignore failures; preflightWriteSSE already logs.
          })
        }, resolveSsePingIntervalMs())
      }

      const stopPreflightHeartbeat = () => {
        if (!preflightHeartbeat) return
        clearInterval(preflightHeartbeat)
        preflightHeartbeat = null
      }

      try {
        if (wantsGitHubReview && gitHubPullRequest && gitHubPullRequestUrl) {
          startPreflightHeartbeat()

          const started = await preflightWriteSSE({
            type: 'status',
            message: `Preparing GitHub PR review: ${gitHubPullRequestUrl}`,
          })
          if (!started) {
            throw new Error('Client disconnected.')
          }

          if (!trimmedGitHubToken) {
            const ghToken = await resolveGitHubTokenFromGh()
            if (ghToken) {
              trimmedGitHubToken = ghToken
              const ok = await preflightWriteSSE({
                type: 'status',
                message: 'Using GitHub CLI authentication (gh auth token).',
              })
              if (!ok) {
                throw new Error('Client disconnected.')
              }
            }
          }

          const prDetails = await fetchGitHubPullRequestDetails({
            pullRequest: gitHubPullRequest,
            token: trimmedGitHubToken || undefined,
          })

          const diffStatus = await preflightWriteSSE({
            type: 'status',
            message: 'Fetching GitHub PR diff...',
          })
          if (!diffStatus) {
            throw new Error('Client disconnected.')
          }

          const pullRequestDiff = await fetchGitHubPullRequestDiff({
            pullRequest: gitHubPullRequest,
            token: trimmedGitHubToken || undefined,
          })

          const fetching = await preflightWriteSSE({
            type: 'status',
            message: 'Checking out GitHub PR...',
          })
          if (!fetching) {
            throw new Error('Client disconnected.')
          }

          checkout = await checkoutGitHubPullRequest({
            cloneUrl: prDetails.cloneUrl,
            sshUrl: prDetails.sshUrl || undefined,
            pullRequest: gitHubPullRequest,
            baseSha: prDetails.baseSha,
            headSha: prDetails.headSha,
            token: trimmedGitHubToken || undefined,
          })
          reviewWorkspaceRoot = checkout.workspaceRoot
          githubEnv = {
            githubSha: checkout.headSha,
            baseSha: checkout.baseSha,
            githubToken: trimmedGitHubToken,
            pullRequest: gitHubPullRequest,
            pullRequestDiff,
          }

          await preflightWriteSSE({
            type: 'status',
            message: `GitHub PR checkout ready (${checkout.headSha.slice(0, 7)}). Starting review...`,
          })
        }
      } catch (error) {
        stopPreflightHeartbeat()

        const message = error instanceof Error ? error.message : String(error)
        const hint = message.includes('API rate limit exceeded')
          ? ' GitHub API rate limit exceeded. Authenticate with GitHub (UI login) or provide a GitHub token, then retry.'
          : ''
        await preflightWriteSSE({
          type: 'error',
          message: `Failed to prepare review: ${message}${hint}`,
        })

        if (checkout) {
          try {
            await checkout.cleanup()
          } catch (cleanupError) {
            logger.warn(`Failed to cleanup GitHub PR checkout: ${String(cleanupError)}`)
          }
        }

        return
      } finally {
        stopPreflightHeartbeat()
      }

      const runReviewWithEnv = async () => {
        if (githubEnv) {
          return withGitHubEnvVariables(githubEnv, runReview)
        }
        return runReview()
      }

      try {
        if (reviewWorkspaceRoot) {
          await withWorkspaceRoot(reviewWorkspaceRoot, runReviewWithEnv)
          return
        }
        await runReviewWithEnv()
      } finally {
        if (checkout) {
          try {
            await checkout.cleanup()
          } catch (cleanupError) {
            logger.warn(`Failed to cleanup GitHub PR checkout: ${String(cleanupError)}`)
          }
        }
      }
    }

    return runWithWorkspace()
  })
})

// Serve static files (Frontend)
// Prefer the newest build between dist/web and web/dist.
const distIndex = './dist/web/index.html'
const devIndex = './web/dist/index.html'
const distExists = existsSync(distIndex)
const devExists = existsSync(devIndex)

const staticRoot = (() => {
  if (distExists && devExists) {
    try {
      return statSync(distIndex).mtimeMs >= statSync(devIndex).mtimeMs
        ? './dist/web'
        : './web/dist'
    } catch {
      return './dist/web'
    }
  }
  if (distExists) return './dist/web'
  if (devExists) return './web/dist'
  return null
})()

if (staticRoot) {
  const serveIndex = serveStatic({ root: staticRoot, path: 'index.html' })
  app.get('/', serveIndex)
  app.use('/*', serveStatic({ root: staticRoot }))
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next()
    return serveIndex(c, next)
  })
} else {
  logger.warn('No frontend build found (expected ./dist/web or ./web/dist).')
  app.get('/', (c) =>
    c.html(
      `<html><body style="font-family: ui-sans-serif, system-ui; padding: 24px; background: #05060a; color: #e2e8f0;">
        <h1 style="margin: 0 0 12px;">Frontend not built</h1>
        <p style="margin: 0 0 16px; color: #94a3b8;">Run <code>cd web &amp;&amp; bun run dev</code> for development, or <code>cd web &amp;&amp; bun run build</code> then restart this server.</p>
      </body></html>`
    )
  )
}

export default {
  port: 3000,
  fetch: app.fetch,
  idleTimeout: resolveServerIdleTimeoutSeconds(),
}
