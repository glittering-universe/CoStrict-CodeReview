import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { loadDotenv } from './common/config/dotenv'
import { resolveLlmCredentials } from './common/config/llmCredentials'
import { getFilesWithChanges } from './common/git/getFilesWithChanges'
import { MCPClientManager } from './common/llm/mcp/client'
import { createModel } from './common/llm/models'
import { getAllTools } from './common/llm/tools'
import type { SandboxExecApprovalResponse } from './common/llm/tools/sandboxExec'
import { getPlatformProvider } from './common/platform/factory'
import { logger } from './common/utils/logger'
import { reviewAgent } from './review/agent/generate'
import { constructPrompt } from './review/prompt'
import { filterFiles } from './review/utils/filterFiles'

loadDotenv()

const app = new Hono()
const sandboxWaiters = new Map<
  string,
  { resolve: (response: SandboxExecApprovalResponse) => void }
>()

const resolveSsePingIntervalMs = (): number => {
  const raw = process.env.SHIPPIE_SSE_PING_INTERVAL_MS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 5000
}

const resolveServerIdleTimeoutSeconds = (): number => {
  const raw = process.env.SHIPPIE_SERVER_IDLE_TIMEOUT
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0) return parsed
  return 120
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

const isProviderToolCallsChunk = (value: unknown): boolean => {
  if (!isRecord(value)) return false

  if (Array.isArray(value.choices)) {
    return value.choices.some((choice) => isProviderToolCallsChunk(choice))
  }

  const delta = value.delta
  if (!isRecord(delta)) return false
  return Array.isArray(delta.tool_calls)
}

const stripProviderJsonFromText = (text: string): string => {
  let cleanText = ''
  let i = 0

  while (i < text.length) {
    if (text[i] === '{') {
      let depth = 0
      let j = i
      while (j < text.length) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') {
          depth--
          if (depth === 0) {
            j++
            break
          }
        }
        j++
      }

      if (depth === 0) {
        const candidate = text.slice(i, j)
        try {
          const parsed = JSON.parse(candidate) as unknown
          if (isProviderToolCallsChunk(parsed)) {
            i = j
            continue
          }
        } catch {
          // ignore parse failures and treat as text
        }
      }
    }

    cleanText += text[i]
    i++
  }

  return cleanText.replace(/\n{3,}/g, '\n\n').trim()
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
    modelString = 'openai:GLM-4-FlashX-250414',
    maxSteps = 25,
    reviewLanguage = 'English',
    apiKey,
    baseUrl,
  } = body

  const credentials = await resolveLlmCredentials()
  const trimmedBaseUrl =
    typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/$/, '') : undefined
  const trimmedApiKey = typeof apiKey === 'string' ? apiKey.trim() : undefined
  const effectiveBaseUrl = trimmedBaseUrl || credentials.openaiApiBase
  const effectiveApiKey = trimmedApiKey || credentials.openaiApiKey

  return streamSSE(c, async (stream) => {
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

      await safeWriteSSE({ type: 'status', message: 'Initializing review...' })

      // 1. Get Files
      logger.debug('Getting platform provider...')
      const platformProvider = await getPlatformProvider('local')
      logger.debug('Getting files with changes...')
      const files = await getFilesWithChanges('local')
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
      const prompt = await constructPrompt(filteredFiles, reviewLanguage)

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
      }: {
        command: string
        cwd: string
        timeout: number
      }): Promise<SandboxExecApprovalResponse> => {
        const requestId = crypto.randomUUID()

        const ok = await safeWriteSSE({
          type: 'sandbox_request',
          requestId,
          command,
          cwd,
          timeout,
        })
        if (!ok) {
          return { approved: false, reason: 'Client disconnected.' }
        }

        return waitForSandboxDecision(requestId, timeout + 60_000)
      }

      const tools = await getAllTools({
        platformProvider,
        model,
        mcpClientManager: clients,
        includeSubAgent: true,
        maxSteps,
        sandboxConfirm,
      })

      // 5. Run Agent
      await safeWriteSSE({ type: 'status', message: 'Agent started...' })

      let submittedReport: string | null = null

      const result = await reviewAgent(
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

          const summaryCall = toolCalls.find((call) =>
            isSubmitSummaryToolName(call.toolName)
          )
          const reportValue = summaryCall ? extractReportFromArgs(summaryCall.args) : null
          if (reportValue) submittedReport = reportValue

          // Stream step
          const ok = await safeWriteSSE({
            type: 'step',
            step: {
              toolCalls,
              toolResults,
              text:
                typeof step.text === 'string' ? stripProviderJsonFromText(step.text) : '',
              usage: step.usage,
            },
          })
          if (!ok) {
            // Stop work if the client is gone; prevents throwing and tearing down the response.
            throw new Error('Client disconnected.')
          }
        }
      )

      // Final result
      await safeWriteSSE({
        type: 'complete',
        result: submittedReport ?? result.text,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cause =
        error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined
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
  })
})

// Serve static files (Frontend)
// Prefer packaged output under dist/web; fall back to web/dist for local development.
const staticRoot = existsSync('./dist/web/index.html')
  ? './dist/web'
  : existsSync('./web/dist/index.html')
    ? './web/dist'
    : null

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
