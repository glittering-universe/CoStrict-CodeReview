import { describe, expect, test } from 'bun:test'
import { tool } from 'ai'
import { MockLanguageModelV1 } from 'ai/test'
import { z } from 'zod'
import { reviewAgent } from '../generate'

const waitFor = async (condition: () => boolean, timeoutMs = 1000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for condition')
}

describe('reviewAgent', () => {
  test('awaits async onStep callback before continuing', async () => {
    let generateCalls = 0
    let step2GenerateCalled = false

    let releaseStep: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseStep = resolve
    })

    const model = new MockLanguageModelV1({
      doGenerate: async () => {
        generateCalls += 1

        if (generateCalls === 1) {
          return {
            toolCalls: [
              {
                toolCallId: 'call-1',
                toolName: 'ls',
                args: JSON.stringify({ path: '.' }),
              },
            ],
            finishReason: 'tool-calls',
            usage: { promptTokens: 1, completionTokens: 1 },
            rawCall: { rawPrompt: null, rawSettings: {} },
          }
        }

        step2GenerateCalled = true
        return {
          text: 'done',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        }
      },
    })

    const tools = {
      ls: tool({
        description: 'List directory contents.',
        parameters: z.object({ path: z.string() }),
        execute: async ({ path }) => `listed:${path}`,
      }),
    }

    let step1Seen = false
    const runPromise = reviewAgent(
      'test prompt',
      model,
      5,
      tools,
      undefined,
      async (step) => {
        if (!step1Seen && step.toolCalls?.some((call) => call.toolName === 'ls')) {
          step1Seen = true
          await gate
        }
      }
    )

    await waitFor(() => step1Seen)
    expect(step2GenerateCalled).toBe(false)

    releaseStep?.()

    const result = await runPromise
    expect(step2GenerateCalled).toBe(true)
    expect(result.text).toBe('done')
  })

  test('invokes onSummarySubmit for submit_summary tool name variants', async () => {
    let summaryCalled = false
    let generateCalls = 0

    const model = new MockLanguageModelV1({
      doGenerate: async () => {
        generateCalls += 1

        if (generateCalls === 1) {
          return {
            toolCalls: [
              {
                toolCallId: 'call-1',
                toolName: 'SUBMIT_SUMMARY',
                args: JSON.stringify({ report: 'hello' }),
              },
            ],
            finishReason: 'tool-calls',
            usage: { promptTokens: 1, completionTokens: 1 },
            rawCall: { rawPrompt: null, rawSettings: {} },
          }
        }

        return {
          text: 'Review completed successfully.',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        }
      },
    })

    const tools = {
      SUBMIT_SUMMARY: tool({
        description: 'Submit summary.',
        parameters: z.object({ report: z.string() }),
        execute: async ({ report }) => `submitted:${report}`,
      }),
    }

    const result = await reviewAgent('test prompt', model, 5, tools, () => {
      summaryCalled = true
    })

    expect(summaryCalled).toBe(true)
    expect(result.text).toBe('Review completed successfully.')
  })
})
