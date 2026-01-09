import type { LanguageModelV1, Tool } from 'ai'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import type { PlatformProvider } from '../../platform/provider'
import { logger } from '../../utils/logger'
import { MCPClientManager } from '../mcp/client'
import { bashTool } from './bash'
import { fetchTool } from './fetch'
import { globTool } from './glob'
import { grepTool } from './grep'
import { lsTool } from './ls'
import { planTool } from './plan'
import { createReadDiffTool } from './readDiff'
import { readFileTool } from './readFile'
import { reportBugTool } from './reportBug'
import {
  type SandboxExecConfirm,
  type SandboxExecOnEvent,
  createSandboxExecTool,
} from './sandboxExec'
import { extractSubAgentReport } from './subAgentReport'
import { summarizeSubAgentReportForContext } from './subAgentSummary'
import { thinkingTool } from './thinking'

const resolveMaxModelRetries = (): number => {
  const raw = process.env.COSTRICT_LLM_CALL_MAX_RETRIES
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }
  return 6
}

const resolveStepDelayMs = (): number => {
  const raw = process.env.COSTRICT_LLM_STEP_DELAY_MS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }
  return 0
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPreflightGoal = (goal: string): boolean =>
  /^\s*\[(Static Analysis Agent|Logic Analysis Agent|Memory & Performance Agent|Security Analysis Agent)\]/.test(
    goal
  )

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

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value
  const headChars = Math.max(0, Math.floor(maxLength * 0.7))
  const tailChars = Math.max(0, maxLength - headChars)
  const head = value.slice(0, headChars).trimEnd()
  const tail = value.slice(-tailChars).trimStart()
  return `${head}\n\n... [truncated: ${value.length} chars total] ...\n\n${tail}`
}

const normalizeToolCall = (
  value: unknown
): { toolName: string; args: unknown } | null => {
  if (!isRecord(value)) return null
  if ('toolName' in value || 'args' in value) {
    const toolName = typeof value.toolName === 'string' ? value.toolName : ''
    const args = parseJsonIfString((value as { args?: unknown }).args)
    return toolName ? { toolName, args } : null
  }

  const fn = value.function
  if (isRecord(fn)) {
    const toolName = typeof fn.name === 'string' ? fn.name : ''
    const args = parseJsonIfString(fn.arguments)
    return toolName ? { toolName, args } : null
  }

  return null
}

const normalizeToolCalls = (value: unknown): { toolName: string; args: unknown }[] => {
  if (!Array.isArray(value)) return []
  return value.map((entry) => normalizeToolCall(entry)).filter(Boolean) as {
    toolName: string
    args: unknown
  }[]
}

const normalizeToolResult = (
  value: unknown
): { toolName: string; args?: unknown; result?: unknown } | null => {
  if (!isRecord(value)) return null
  const toolName = typeof value.toolName === 'string' ? value.toolName : ''
  if (!toolName) return null
  const args = parseJsonIfString((value as { args?: unknown }).args)
  const result = parseJsonIfString((value as { result?: unknown }).result)
  return { toolName, args, result }
}

const normalizeToolResults = (
  value: unknown
): { toolName: string; args?: unknown; result?: unknown }[] => {
  if (!Array.isArray(value)) return []
  return value.map((entry) => normalizeToolResult(entry)).filter(Boolean) as {
    toolName: string
    args?: unknown
    result?: unknown
  }[]
}

const formatValueForEvidence = (value: unknown, maxChars: number): string => {
  if (typeof value === 'string') return truncateText(value, maxChars)
  try {
    return truncateText(JSON.stringify(value), maxChars)
  } catch {
    return truncateText(String(value), maxChars)
  }
}

const formatSubAgentRecoveryEvidence = (
  result: {
    text?: string
    toolCalls?: unknown
    toolResults?: unknown
    steps?: unknown
    finishReason?: unknown
  },
  maxChars = 8000
): string => {
  const blocks: string[] = []

  const finishReason =
    typeof result.finishReason === 'string' ? result.finishReason : undefined
  if (finishReason) {
    blocks.push(`finishReason: ${finishReason}`)
  }

  const text = typeof result.text === 'string' ? result.text.trim() : ''
  if (text) {
    blocks.push(`text:\n${truncateText(text, 2000)}`)
  }

  const toolCalls = normalizeToolCalls(result.toolCalls)
  const toolResults = normalizeToolResults(result.toolResults)
  if (toolCalls.length > 0) {
    const lines = toolCalls
      .slice(0, 12)
      .map((call) => `- ${call.toolName} ${formatValueForEvidence(call.args, 500)}`)
    blocks.push(`toolCalls:\n${lines.join('\n')}`)
  }
  if (toolResults.length > 0) {
    const lines = toolResults
      .slice(0, 12)
      .map(
        (entry) =>
          `- ${entry.toolName} result=${formatValueForEvidence(entry.result, 1200)}`
      )
    blocks.push(`toolResults:\n${lines.join('\n')}`)
  }

  if (Array.isArray(result.steps)) {
    const stepBlocks: string[] = []
    const steps = result.steps.slice(-8)
    for (const [index, step] of steps.entries()) {
      if (!isRecord(step)) continue
      const stepLines: string[] = []
      const stepText = typeof step.text === 'string' ? step.text.trim() : ''
      if (stepText) {
        stepLines.push(`text: ${truncateText(stepText, 800)}`)
      }
      const calls = normalizeToolCalls(step.toolCalls)
      if (calls.length > 0) {
        stepLines.push(
          ...calls
            .slice(0, 6)
            .map(
              (call) => `call: ${call.toolName} ${formatValueForEvidence(call.args, 300)}`
            )
        )
      }
      const results = normalizeToolResults(step.toolResults)
      if (results.length > 0) {
        stepLines.push(
          ...results
            .slice(0, 6)
            .map(
              (entry) =>
                `result: ${entry.toolName} ${formatValueForEvidence(entry.result, 600)}`
            )
        )
      }
      if (stepLines.length > 0) {
        stepBlocks.push(`step ${index + 1}:\n${stepLines.join('\n')}`)
      }
    }
    if (stepBlocks.length > 0) {
      blocks.push(`steps:\n${stepBlocks.join('\n\n')}`)
    }
  }

  return truncateText(blocks.join('\n\n').trim(), maxChars)
}

const hasReportSection = (report: string, name: string): boolean =>
  new RegExp(`^\\s*#{2,6}\\s*${name}\\b`, 'im').test(report)

const isStructuredSubAgentReport = (report: string): boolean =>
  hasReportSection(report, 'Summary') &&
  hasReportSection(report, 'Findings') &&
  hasReportSection(report, 'Recommendations?') &&
  hasReportSection(report, 'Conclusion')

const countBulletLines = (report: string): number => {
  const matches = report.match(/^\s*(?:[-*+]|\d+[.)])\s+\S+/gm)
  return matches?.length ?? 0
}

const shouldRewriteReport = (goal: string, report: string): boolean => {
  if (!isPreflightGoal(goal)) return false
  const trimmed = report.trim()
  if (!trimmed) return true
  const lowered = trimmed.toLowerCase()
  if (lowered.includes('produced no report output')) return true
  if (lowered.includes('no performance analysis completed')) return true
  if (lowered.includes('no report output')) return true
  if (lowered.includes('did not return reports')) return true
  if (!isStructuredSubAgentReport(trimmed)) return true
  if (countBulletLines(trimmed) < 3) return true
  if (/^\s*(now let me|let me)\b/i.test(trimmed)) return true
  return trimmed.length > 12000
}

const normalizeReturnedReport = (goal: string, report: string): string => {
  const trimmed = report.trim()
  if (!trimmed) {
    return '## Summary\nSub-agent returned an empty report.\n\n## Findings\n- No report content was produced.\n\n## Recommendations\n- Retry sub-agent execution with sufficient maxSteps.\n- Ensure the sub-agent reads diffs/files before summarizing.\n\n## Conclusion\nInsufficient data to assess changes.'
  }

  if (!isPreflightGoal(goal)) return trimmed

  const lowered = trimmed.toLowerCase()
  if (
    lowered.includes('produced no report output') ||
    lowered.includes('no report output') ||
    lowered.includes('no performance analysis completed')
  ) {
    return `## Summary\nSub-agent did not produce a usable report.\n\n## Findings\n- Returned output: ${truncateText(trimmed, 800)}\n\n## Recommendations\n- Retry sub-agent execution.\n- Ensure the sub-agent reads diffs/files and ends by calling submit_report.\n\n## Conclusion\nInsufficient data to assess changes from sub-agent output.`
  }

  if (trimmed.length <= 8000) return trimmed

  const summary = summarizeSubAgentReportForContext(trimmed)
  if (!summary) return truncateText(trimmed, 8000)

  const summaryLines = summary.split(/\r?\n/).map((line) => line.trim())
  const findings: string[] = []
  const recommendations: string[] = []
  let mode: 'findings' | 'recommendations' | null = null
  for (const line of summaryLines) {
    if (/^key findings:/i.test(line)) {
      mode = 'findings'
      continue
    }
    if (/^key recommendations:/i.test(line)) {
      mode = 'recommendations'
      continue
    }
    if (line.startsWith('- ')) {
      const value = line.slice(2).trim()
      if (!value) continue
      if (mode === 'recommendations') recommendations.push(value)
      else findings.push(value)
    }
  }

  const findingsBlock =
    findings.length > 0
      ? findings.map((item) => `- ${item}`).join('\n')
      : '- No concrete findings could be extracted from the raw report.'
  const recommendationsBlock =
    recommendations.length > 0
      ? recommendations.map((item) => `- ${item}`).join('\n')
      : '- Ensure the sub-agent inspects diffs and includes concrete observations.'

  return `## Summary\nCondensed sub-agent report (raw output exceeded size limits).\n\n## Findings\n${findingsBlock}\n\n## Recommendations\n${recommendationsBlock}\n\n## Conclusion\nSee raw logs for full details if needed.`
}

const submitReportTool = tool({
  description: 'Submit a report to the main agent. This is how you finish your work.',
  parameters: z.object({
    report: z.string().describe('The report to submit to the main agent'),
  }),
})

export const createSubAgentTool = (
  parentModel: LanguageModelV1,
  maxSteps: number,
  options: {
    sandboxConfirm?: SandboxExecConfirm
    sandboxOnEvent?: SandboxExecOnEvent
    platformProvider?: PlatformProvider
  } = {}
) => {
  return tool({
    description:
      'Spawn a sub-agent with a specific goal that runs autonomously with access to all available tools. The sub-agent will work towards the goal and return a structured report with findings and recommendations. Use this subagent to run token heavy tasks which can be run async from the main agent.',
    parameters: z.object({
      goal: z
        .string()
        .describe(
          'The specific goal or task for the sub-agent to accomplish. Include as much context as possible to help the sub-agent understand the goal.'
        ),
    }),
    execute: async ({ goal }) => {
      const stepDelayMs = resolveStepDelayMs()
      let mcpClientManager: MCPClientManager | null = null
      try {
        logger.info(`Spawning sub-agent with goal: ${goal}`)
        const model: LanguageModelV1 = parentModel
        const preflight = isPreflightGoal(goal)

        if (!preflight) {
          mcpClientManager = new MCPClientManager()
          await mcpClientManager.loadConfig()
          await mcpClientManager.startClients()
        }

        const tools: Record<string, Tool> = {
          submit_report: submitReportTool,
          read_file: readFileTool,
          ...(options.platformProvider
            ? { read_diff: createReadDiffTool(options.platformProvider) }
            : {}),
          glob: globTool,
          grep: grepTool,
          ls: lsTool,
          ...(preflight
            ? {}
            : {
                fetch: fetchTool,
                plan: planTool,
                bash: bashTool,
                sandbox_exec: createSandboxExecTool(
                  options.sandboxConfirm,
                  options.sandboxOnEvent
                ),
                thinking: thinkingTool,
                report_bug: reportBugTool,
              }),
        }

        if (mcpClientManager) {
          const mcpTools: Record<string, Tool> = {}
          for (const [serverName, serverTools] of Object.entries(
            await mcpClientManager.getTools()
          )) {
            for (const [toolName, mcpTool] of Object.entries(serverTools)) {
              mcpTools[`${serverName}-${toolName}`] = mcpTool
            }
          }
          Object.assign(tools, mcpTools)
        }

        logger.debug('Sub-agent tools available:', Object.keys(tools))

        const prompt = `You are an autonomous sub-agent with the following goal: ${goal}

Rules:
- Prefer reading diffs for the specified files (use read_diff if available) and then read_file for minimal needed context.
- Do not include tool-call blobs or raw JSON in your report.
- Keep the report focused and concise (prioritize top issues; avoid long narratives).
${preflight ? '- Do not run shell commands (bash/sandbox_exec) or write bug cards; focus on analysis only.\n' : ''}

CRITICAL REQUIREMENT: You MUST end your work by providing a comprehensive final report that includes:

## Summary
Brief overview of what was accomplished

## Findings
3-6 bullet points with concrete observations (include file paths where possible)

## Recommendations  
Actionable next steps (bullet points)

## Conclusion
Final assessment and key takeaways

Submit the report to the main agent using the 'submit_report' tool.`

        // Run the sub-agent
        const result = await generateText({
          model,
          prompt,
          tools,
          maxRetries: resolveMaxModelRetries(),
          maxSteps,
          experimental_prepareStep: async ({ stepNumber }) => {
            if (stepDelayMs > 0 && stepNumber > 0) {
              await sleep(stepDelayMs)
            }
            return undefined
          },
        })

        const report = extractSubAgentReport({
          toolCalls: result.toolCalls,
          toolResults: result.toolResults,
          steps: result.steps,
        })
        if (report) {
          const normalized = normalizeReturnedReport(goal, report)
          if (!shouldRewriteReport(goal, normalized)) return normalized

          const evidence = formatSubAgentRecoveryEvidence(result)
          const rewritePrompt = `Rewrite the report below into the required report format. Do NOT invent facts. Only include observations that are explicitly present in the report or the evidence.

Goal:
${goal}

Evidence (tool calls/results):
${evidence || '(none)'}

Report to rewrite:
${truncateText(normalized, 8000)}
`
          const rewrite = await generateText({
            model,
            prompt: rewritePrompt,
            tools: { submit_report: submitReportTool },
            toolChoice: { type: 'tool', toolName: 'submit_report' },
            maxRetries: resolveMaxModelRetries(),
            maxSteps: 1,
            experimental_prepareStep: async ({ stepNumber }) => {
              if (stepDelayMs > 0 && stepNumber > 0) {
                await sleep(stepDelayMs)
              }
              return undefined
            },
          })

          const rewritten = extractSubAgentReport({
            toolCalls: rewrite.toolCalls,
            toolResults: rewrite.toolResults,
            steps: rewrite.steps,
          })
          return normalizeReturnedReport(goal, rewritten ?? normalized)
        }

        logger.error('Sub-agent completed execution but produced no submit_report output')
        logger.error('Sub-agent result finishReason:', result.finishReason)
        logger.debug('Sub-agent result steps:', result.steps)
        logger.info('Sub-agent result text:', result.text)

        const evidence = formatSubAgentRecoveryEvidence(result)
        if (evidence) {
          const recoveryPrompt = `You did not call submit_report. Produce the final report now. Do NOT invent facts. Base findings/recommendations on the evidence. If evidence is insufficient, say so explicitly.

Goal:
${goal}

Evidence (tool calls/results):
${evidence}
`
          const recovery = await generateText({
            model,
            prompt: recoveryPrompt,
            tools: { submit_report: submitReportTool },
            toolChoice: { type: 'tool', toolName: 'submit_report' },
            maxRetries: resolveMaxModelRetries(),
            maxSteps: 1,
            experimental_prepareStep: async ({ stepNumber }) => {
              if (stepDelayMs > 0 && stepNumber > 0) {
                await sleep(stepDelayMs)
              }
              return undefined
            },
          })

          const recoveredReport = extractSubAgentReport({
            toolCalls: recovery.toolCalls,
            toolResults: recovery.toolResults,
            steps: recovery.steps,
          })
          if (recoveredReport) {
            return normalizeReturnedReport(goal, recoveredReport)
          }
        }

        const fallbackReport = normalizeReturnedReport(
          goal,
          result.text
            ? result.text
            : 'Sub-agent completed execution but produced no report output'
        )
        return fallbackReport
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Error in sub-agent execution: ${message}`)
        if (error instanceof Error && error.stack) {
          logger.debug(error.stack)
        }
        if (error instanceof Error) {
          return `Error executing sub-agent: ${error.message}`
        }
        return 'Unknown error occurred while executing sub-agent'
      } finally {
        try {
          if (mcpClientManager) {
            await mcpClientManager.closeClients()
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn(`Failed to close sub-agent MCP clients: ${message}`)
        }
      }
    },
  })
}
