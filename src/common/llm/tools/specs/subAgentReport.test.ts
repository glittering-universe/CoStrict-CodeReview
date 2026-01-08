import { describe, expect, test } from 'bun:test'
import { extractSubAgentReport } from '../subAgentReport'

describe('extractSubAgentReport', () => {
  test('finds submit_report in steps', () => {
    const report = extractSubAgentReport({
      steps: [
        { toolCalls: [{ toolName: 'read_file', args: { path: 'README.md' } }] },
        { toolCalls: [{ toolName: 'submit_report', args: { report: 'done' } }] },
      ],
    })

    expect(report).toBe('done')
  })

  test('parses stringified args', () => {
    const report = extractSubAgentReport({
      toolCalls: [
        {
          toolName: 'submit_report',
          args: '{"report":"hello"}',
        },
      ],
    })

    expect(report).toBe('hello')
  })

  test('reads report from tool results', () => {
    const report = extractSubAgentReport({
      toolResults: [
        {
          toolName: 'submit_report',
          result: { report: 'ok' },
        },
      ],
    })

    expect(report).toBe('ok')
  })

  test('returns null when submit_report is missing', () => {
    const report = extractSubAgentReport({
      toolCalls: [{ toolName: 'read_file', args: { path: 'README.md' } }],
    })

    expect(report).toBeNull()
  })
})
