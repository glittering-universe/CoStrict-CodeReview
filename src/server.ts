import crypto from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { generateText } from 'ai'
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { loadDotenv } from './common/config/dotenv'
import { loadLlmCredentials, resolveLlmCredentials } from './common/config/llmCredentials'
import { getFilesWithChanges } from './common/git/getFilesWithChanges'
import { MCPClientManager } from './common/llm/mcp/client'
import { createModel } from './common/llm/models'
import { stripProviderJsonFromText } from './common/llm/stripProviderJson'
import { getAllTools } from './common/llm/tools'
import type {
  SandboxExecApprovalResponse,
  SandboxExecOnEvent,
} from './common/llm/tools/sandboxExec'
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

const resolveSandboxExecRepeatLimit = (): number => {
  const raw = process.env.SHIPPIE_SANDBOX_EXEC_REPEAT_LIMIT
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 2) return parsed
  return 4
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
    modelString = 'openai:GLM-4-Flash',
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
        if (alreadySawReportBug || !reportText || !containsBugKeywords(reportText)) {
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
                typeof step.text === 'string' ? stripProviderJsonFromText(step.text) : '',
              usage: step.usage,
            },
          })
          if (!ok) {
            throw new Error('Client disconnected.')
          }
        }

        const candidates = extractBugCandidates(reportText).slice(0, 10)

        const verifyAndReportSingleBug = async (candidate: string) => {
          const bugPrompt = `You previously completed a PR review.

Task (MANDATORY):
- You are handling ONE bug candidate (below).
- You MUST attempt to verify it via sandbox_exec (requires user approval).
- Run EXACTLY ONE sandbox_exec command for this bug. Do NOT loop or retry the same command.
- After sandbox_exec (or if denied / infeasible), call report_bug EXACTLY ONCE for this bug.
- Set status VERIFIED only if sandbox output demonstrates the bug; otherwise UNVERIFIED with the reason.
- Do NOT call submit_summary.
- Do NOT output long narrative text. Prefer tool calls only.
- Even if multiple bugs could share the same command, DO NOT reuse one sandbox_exec run for multiple bug cards. This bug needs its own sandbox_exec attempt and its own report_bug card.

Bug candidate:
${candidate}

Context summary:
${reportText}
`

          await reviewAgent(
            bugPrompt,
            model,
            Math.min(maxSteps, 6),
            { sandbox_exec: tools.sandbox_exec, report_bug: tools.report_bug },
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

Summary to extract from:
${reportText}
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
            const title = candidate.length > 90 ? `${candidate.slice(0, 89)}…` : candidate
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
