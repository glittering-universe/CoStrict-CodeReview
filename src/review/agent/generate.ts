import {
  type GenerateTextResult,
  type LanguageModelV1,
  type Tool,
  generateText,
} from 'ai'
import { logger } from '../../common/utils/logger'

type ReviewStepEvent = {
  toolCalls: unknown
  text: string
  usage: unknown
}

export const reviewAgent = async (
  prompt: string,
  model: LanguageModelV1,
  maxSteps: number,
  tools: Record<string, Tool>,
  onSummarySubmit?: () => void,
  onStep?: (step: ReviewStepEvent) => void
  // biome-ignore lint/suspicious/noExplicitAny: fine
): Promise<GenerateTextResult<Record<string, any>, string>> => {
  return generateText({
    model,
    prompt,
    tools,
    maxSteps,
    onStepFinish: (step) => {
      logger.debug('Step finished:', step)

      const summaryToolUsed = step.toolCalls.some(
        (tc) => tc.toolName === 'submit_summary'
      )

      if (summaryToolUsed && onSummarySubmit) {
        logger.debug('Detected submit_summary tool usage in step, triggering callback.')
        onSummarySubmit()
      }

      if (onStep) {
        onStep(step)
      }
    },
  })
}
