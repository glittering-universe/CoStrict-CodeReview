import { describe, expect, test } from 'bun:test'
import { MockLanguageModelV1 } from 'ai/test'
import { createSubAgentTool } from '../subAgent'

describe('createSubAgentTool', () => {
  test('recovers when the model never calls submit_report and returns empty text', async () => {
    let generateCalls = 0

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

        if (generateCalls === 2) {
          return {
            text: '',
            finishReason: 'stop',
            usage: { promptTokens: 1, completionTokens: 1 },
            rawCall: { rawPrompt: null, rawSettings: {} },
          }
        }

        return {
          toolCalls: [
            {
              toolCallId: 'call-2',
              toolName: 'submit_report',
              args: JSON.stringify({
                report:
                  '## Summary\nRecovered.\n\n## Findings\n- One.\n\n## Recommendations\n- Two.\n\n## Conclusion\nDone.',
              }),
            },
          ],
          finishReason: 'tool-calls',
          usage: { promptTokens: 1, completionTokens: 1 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        }
      },
    })

    const tool = createSubAgentTool(model, 5)

    const result = await tool.execute?.(
      {
        goal: '[Static Analysis Agent] Scan changed code for syntax, type, and style risks.',
      },
      { toolCallId: 'subagent-test', messages: [] }
    )

    expect(typeof result).toBe('string')
    expect(result).toContain('## Summary')
    expect(result).toContain('Recovered.')
    expect(result).toContain('## Findings')
    expect(result).toContain('## Recommendations')
    expect(result).toContain('## Conclusion')
  })

  test('rewrites low-quality submit_report output for preflight goals', async () => {
    let generateCalls = 0

    const model = new MockLanguageModelV1({
      doGenerate: async () => {
        generateCalls += 1

        if (generateCalls === 1) {
          return {
            toolCalls: [
              {
                toolCallId: 'call-1',
                toolName: 'submit_report',
                args: JSON.stringify({
                  report: 'Now let me check the resolveSsePingIntervalMs function:',
                }),
              },
            ],
            finishReason: 'tool-calls',
            usage: { promptTokens: 1, completionTokens: 1 },
            rawCall: { rawPrompt: null, rawSettings: {} },
          }
        }

        return {
          toolCalls: [
            {
              toolCallId: 'call-2',
              toolName: 'submit_report',
              args: JSON.stringify({
                report:
                  '## Summary\nRewritten.\n\n## Findings\n- One.\n- Two.\n- Three.\n\n## Recommendations\n- Fix A.\n- Fix B.\n- Fix C.\n\n## Conclusion\nDone.',
              }),
            },
          ],
          finishReason: 'tool-calls',
          usage: { promptTokens: 1, completionTokens: 1 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        }
      },
    })

    const tool = createSubAgentTool(model, 5)

    const result = await tool.execute?.(
      {
        goal: '[Security Analysis Agent] Look for security risks, threat vectors, and unsafe patterns.',
      },
      { toolCallId: 'subagent-test-rewrite', messages: [] }
    )

    expect(typeof result).toBe('string')
    expect(result).toContain('## Summary')
    expect(result).toContain('Rewritten.')
    expect(result).toContain('## Findings')
    expect(result).toContain('## Recommendations')
    expect(result).toContain('## Conclusion')
    expect(generateCalls).toBeGreaterThanOrEqual(2)
  })
})
