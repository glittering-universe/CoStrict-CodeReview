type SubAgentToolCall = {
  toolName?: string
  args?: unknown
}

type SubAgentToolResult = {
  toolName?: string
  args?: unknown
  result?: unknown
}

type SubAgentStep = {
  toolCalls?: SubAgentToolCall[]
  toolResults?: SubAgentToolResult[]
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

const isSubmitReportToolName = (toolName: unknown): boolean => {
  if (typeof toolName !== 'string') return false
  const normalized = normalizeToolNameKey(toolName)
  return normalized === 'submit_report' || normalized === 'submitreport'
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

const extractReportFromValue = (value: unknown): string | null => {
  const parsed = parseJsonIfString(value)
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim()
    return trimmed ? trimmed : null
  }
  if (!isRecord(parsed)) return null
  const report = parsed.report
  if (typeof report !== 'string') return null
  const trimmed = report.trim()
  return trimmed ? trimmed : null
}

const findReportInCalls = (
  toolCalls?: SubAgentToolCall[],
  toolResults?: SubAgentToolResult[]
): string | null => {
  if (toolCalls) {
    for (const call of toolCalls) {
      if (!isSubmitReportToolName(call.toolName)) continue
      const report = extractReportFromValue(call.args)
      if (report) return report
    }
  }

  if (toolResults) {
    for (const result of toolResults) {
      if (!isSubmitReportToolName(result.toolName)) continue
      const reportFromResult = extractReportFromValue(result.result)
      if (reportFromResult) return reportFromResult
      const reportFromArgs = extractReportFromValue(result.args)
      if (reportFromArgs) return reportFromArgs
    }
  }

  return null
}

export const extractSubAgentReport = ({
  toolCalls,
  toolResults,
  steps,
}: {
  toolCalls?: SubAgentToolCall[]
  toolResults?: SubAgentToolResult[]
  steps?: SubAgentStep[]
}): string | null => {
  if (steps) {
    for (const step of steps) {
      const report = findReportInCalls(step.toolCalls, step.toolResults)
      if (report) return report
    }
  }

  return findReportInCalls(toolCalls, toolResults)
}
