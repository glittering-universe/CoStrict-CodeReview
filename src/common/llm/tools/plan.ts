import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'

const PLAN_FILENAME = 'plan.md'
const LOG_HEADER = '## Execution Log'
const NOTES_HEADER = '## Notes'
const SECTION_HEADERS = ['## Steps', LOG_HEADER, NOTES_HEADER]

const planStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'blocked'])

type PlanStatus = z.infer<typeof planStatusSchema>

const extractSection = (content: string, header: string): string | null => {
  if (!content) return null
  const lines = content.split('\n')
  let startIndex = -1

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === header) {
      startIndex = i + 1
      break
    }
  }

  if (startIndex === -1) return null

  let endIndex = lines.length
  for (let i = startIndex; i < lines.length; i += 1) {
    if (SECTION_HEADERS.includes(lines[i].trim())) {
      endIndex = i
      break
    }
  }

  const section = lines.slice(startIndex, endIndex).join('\n').trim()
  return section.length > 0 ? section : null
}

const appendSection = (current: string | null, addition?: string): string | null => {
  const trimmed = addition?.trim()
  if (!trimmed) return current
  if (!current) return trimmed
  return `${current}\n\n${trimmed}`
}

const renderPlan = (
  steps: Array<{ step: string; status: PlanStatus }>,
  log: string | null,
  note: string | null
): string => {
  const lines: string[] = [
    '# Plan',
    '',
    `Updated: ${new Date().toISOString()}`,
    '',
    '## Steps',
  ]

  if (steps.length === 0) {
    lines.push('- [pending] <no steps provided>')
  } else {
    for (const entry of steps) {
      lines.push(`- [${entry.status}] ${entry.step}`)
    }
  }

  if (log) {
    lines.push('', LOG_HEADER, log)
  }

  if (note) {
    lines.push('', NOTES_HEADER, note)
  }

  return `${lines.join('\n')}\n`
}

export const planTool = tool({
  description:
    'Maintain the plan file (plan.md) in the repository root. Append execution records and plan adjustments here, and keep step statuses current.',
  parameters: z.object({
    steps: z
      .array(
        z.object({
          step: z.string().describe('Plan step description'),
          status: planStatusSchema.describe('Step status'),
        })
      )
      .describe('Ordered list of steps and their statuses'),
    logEntry: z
      .string()
      .optional()
      .describe('Execution record or plan adjustment entry to append'),
    note: z
      .string()
      .optional()
      .describe('Optional note about progress, context, or blockers'),
  }),
  execute: async ({ steps, logEntry, note }) => {
    const planPath = path.resolve(process.cwd(), PLAN_FILENAME)
    try {
      let existing = ''
      try {
        existing = await fs.readFile(planPath, 'utf8')
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('ENOENT')) {
          throw error
        }
      }

      const existingLog = extractSection(existing, LOG_HEADER)
      const existingNotes = extractSection(existing, NOTES_HEADER)
      const mergedLog = appendSection(existingLog, logEntry)
      const mergedNotes = appendSection(existingNotes, note)

      await fs.writeFile(planPath, renderPlan(steps, mergedLog, mergedNotes), 'utf8')
      return `Plan updated at ${planPath}`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `Error updating plan at '${planPath}': ${message}`
    }
  },
})
