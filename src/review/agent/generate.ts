import {
  type GenerateTextResult,
  type LanguageModelV1,
  type Tool,
  generateText,
} from 'ai'
import { logger } from '../../common/utils/logger'

type ReviewStepEvent = {
  toolCalls: unknown
  toolResults?: unknown
  text: string
  usage: unknown
}

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

const resolveStepDelayMs = (): number => {
  const raw = process.env.COSTRICT_LLM_STEP_DELAY_MS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }
  return 0
}

const resolveMaxModelRetries = (): number => {
  const raw = process.env.COSTRICT_LLM_CALL_MAX_RETRIES
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }
  return 6
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const reviewAgent = async (
  prompt: string,
  model: LanguageModelV1,
  maxSteps: number,
  tools: Record<string, Tool>,
  onSummarySubmit?: () => void,
  onStep?: (step: ReviewStepEvent) => void | Promise<void>,
  abortSignal?: AbortSignal
  // biome-ignore lint/suspicious/noExplicitAny: fine
): Promise<GenerateTextResult<Record<string, any>, string>> => {
  const stepDelayMs = resolveStepDelayMs()
  return generateText({
    model,
    prompt,
    tools,
    abortSignal,
    maxRetries: resolveMaxModelRetries(),
    maxSteps,
    experimental_prepareStep: async ({ stepNumber }) => {
      if (stepDelayMs > 0 && stepNumber > 0) {
        await sleep(stepDelayMs)
      }
      return undefined
    },
    onStepFinish: async (step) => {
      logger.debug('Step finished:', step)

      const summaryToolUsed = step.toolCalls.some((tc) =>
        isSubmitSummaryToolName(tc.toolName)
      )

      if (summaryToolUsed && onSummarySubmit) {
        logger.debug('Detected submit_summary tool usage in step, triggering callback.')
        onSummarySubmit()
      }

      if (onStep) {
        await onStep(step)
      }
    },
  })
}
