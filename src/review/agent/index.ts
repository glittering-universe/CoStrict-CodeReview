import type { GenerateTextResult, LanguageModelV1 } from 'ai'
import { accumulateTokenUsage, formatToolUsage } from '../../common/formatting/usage'
import { MCPClientManager } from '../../common/llm/mcp/client'
import { getAllTools } from '../../common/llm/tools'
import type { PlatformProvider } from '../../common/platform/provider'
import { logger } from '../../common/utils/logger'
import type { TokenUsage, ToolCall } from '../types'
import { reviewAgent } from './generate'

export const runAgenticReview = async (
  initialPrompt: string,
  model: LanguageModelV1,
  platformProvider: PlatformProvider,
  maxSteps: number,
  maxRetries = 6
): Promise<string> => {
  logger.info(`Running agentic review (max retries: ${maxRetries})...`)

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const isNonRetryableBillingError = (message: string): boolean => {
    return (
      message.includes('1113') ||
      message.includes('余额不足') ||
      message.includes('无可用资源包') ||
      message.includes('payment required') ||
      message.includes('insufficient balance') ||
      message.includes('insufficient_quota') ||
      message.includes('insufficient quota') ||
      message.includes('exceeded your current quota') ||
      message.includes('billing') ||
      message.includes('402')
    )
  }
  const isTransientNetworkError = (error: unknown): boolean => {
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase()
    if (isNonRetryableBillingError(msg)) {
      return false
    }
    return (
      msg.includes('network error') ||
      msg.includes('fetch failed') ||
      msg.includes('etimedout') ||
      msg.includes('econnreset') ||
      msg.includes('socket hang up') ||
      msg.includes('timeout') ||
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests') ||
      msg.includes('overloaded') ||
      msg.includes('当前api请求过多') ||
      msg.includes('请稍后重试') ||
      msg.includes('temporarily unavailable') ||
      msg.includes('retry later')
    )
  }
  const resolvedMaxRetries =
    Number.parseInt(process.env.COSTRICT_LLM_MAX_RETRIES ?? '', 10) || maxRetries
  logger.info(`Resolved max retries for agent: ${resolvedMaxRetries}`)

  const parseRetryAfterSeconds = (message: string): number | undefined => {
    const retryAfter = message.match(/retry[-\s]?after[:\s]?(\d+)/i)
    if (retryAfter?.[1]) {
      const parsed = Number.parseInt(retryAfter[1], 10)
      return Number.isNaN(parsed) ? undefined : parsed
    }
    return undefined
  }

  const clients = new MCPClientManager()
  await clients.loadConfig()
  await clients.startClients()

  const tools = await getAllTools({
    platformProvider,
    model,
    mcpClientManager: clients,
    includeSubAgent: true,
    maxSteps,
  })

  logger.debug('Tools:', Object.keys(tools))

  // biome-ignore lint/suspicious/noExplicitAny: fine for GenerateTextResult generics
  let latestResult: GenerateTextResult<Record<string, any>, string> | null = null
  let currentPrompt = initialPrompt
  let accumulatedContext = ''
  let summaryToolCalled = false

  let tokenUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  }
  let toolUsage: ToolCall[] = []

  try {
    for (let attempt = 1; attempt <= resolvedMaxRetries; attempt++) {
      logger.info(`Attempt ${attempt}/${resolvedMaxRetries}...`)
      summaryToolCalled = false

      try {
        latestResult = await reviewAgent(currentPrompt, model, maxSteps, tools, () => {
          summaryToolCalled = true
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`Attempt ${attempt} failed: ${message}`)

        if (attempt < resolvedMaxRetries && isTransientNetworkError(error)) {
          const message = error instanceof Error ? error.message : String(error)
          const retryAfterSeconds = parseRetryAfterSeconds(message.toLowerCase())
          const baseDelay = retryAfterSeconds
            ? retryAfterSeconds * 1000
            : 3000 * attempt + Math.floor(Math.random() * 1000)
          const backoffMs = Math.min(baseDelay, 20000)
          logger.info(
            `Transient network error detected, retrying after ${backoffMs}ms...`
          )
          await sleep(backoffMs)
          continue
        }

        logger.error('Agent execution failed and will not be retried.')
        if (error instanceof Error && error.stack) {
          logger.debug(error.stack)
        }
        throw error
      }

      tokenUsage = accumulateTokenUsage(tokenUsage, latestResult.steps)
      toolUsage = formatToolUsage(toolUsage, latestResult.steps, attempt)

      if (summaryToolCalled) {
        logger.info(
          `Agent submitted summary on attempt ${attempt} (detected via callback).`
        )
        break
      }

      logger.warn(`Agent did not submit summary on attempt ${attempt}.`)

      if (attempt < resolvedMaxRetries) {
        const attemptContext = latestResult.toolResults
          .map((res) => `Tool Result (${res.toolName}): ${JSON.stringify(res.result)}`)
          .join('\n')
        const finalTextContext = latestResult.text
          ? `\nFinal Text: ${latestResult.text}`
          : ''
        accumulatedContext += `\n\n--- Attempt ${attempt} Context ---\n${attemptContext}${finalTextContext}\n--- End Attempt ${attempt} Context ---`
        currentPrompt = `${initialPrompt}${accumulatedContext}\n\nPlease continue the task based on previous attempts and ensure you call submit_summary.`
        logger.info(`Preparing for attempt ${attempt + 1}.`)
      }
    }
  } finally {
    await clients.closeClients()
  }

  if (!latestResult) {
    throw new Error('Agent did not produce any result.')
  }

  if (!summaryToolCalled) {
    logger.error(
      `Agent failed to submit summary after ${resolvedMaxRetries} attempts. Proceeding anyway.`
    )
  } else {
    await platformProvider.submitUsage(tokenUsage, toolUsage)
  }

  return latestResult.text
}
