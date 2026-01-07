import { describe, expect, test } from 'bun:test'
import { extractSubAgentReport } from '../subAgent'

describe('extractSubAgentReport', () => {
  test('prefers submit_report tool call over other tool calls', () => {
    const result = {
      toolCalls: [
        { toolName: 'read_file', args: { path: 'foo' } },
        { toolName: 'submit_report', args: { report: 'final report' } },
      ],
      steps: [],
      text: 'fallback text',
    }

    expect(extractSubAgentReport(result as never)).toBe('final report')
  })

  test('falls back to step tool calls when top-level toolCalls are empty', () => {
    const result = {
      toolCalls: [],
      steps: [
        { toolCalls: [{ toolName: 'submit_report', args: { report: 'from step' } }] },
      ],
      text: '',
    }

    expect(extractSubAgentReport(result as never)).toBe('from step')
  })

  test('falls back to text when no report tool call exists', () => {
    const result = {
      toolCalls: [{ toolName: 'read_file', args: { path: 'foo' } }],
      steps: [],
      text: 'plain text report',
    }

    expect(extractSubAgentReport(result as never)).toBe('plain text report')
  })
})
