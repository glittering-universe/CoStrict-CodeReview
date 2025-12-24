import { tool } from 'ai'
import { z } from 'zod'

export const reportBugTool = tool({
  description:
    'Report a single bug finding as structured data for the UI. Call once per bug, after attempting sandbox verification. Use status VERIFIED only when confirmed via sandbox_exec output; otherwise UNVERIFIED with a reason.',
  parameters: z.object({
    title: z.string().describe('Short title of the bug'),
    description: z
      .string()
      .describe(
        'Markdown description including what is wrong, why it matters, and where it is (file path + line numbers if known).'
      ),
    status: z
      .enum(['VERIFIED', 'UNVERIFIED'])
      .describe('Whether the bug is confirmed via sandbox verification'),
    severity: z
      .enum(['low', 'medium', 'high', 'critical'])
      .describe('Impact severity of the bug')
      .default('medium'),
    filePath: z.string().optional().describe('File path where the bug exists, if known'),
    startLine: z
      .number()
      .int()
      .optional()
      .describe('1-based start line number, if known'),
    endLine: z.number().int().optional().describe('1-based end line number, if known'),
    reproduction: z
      .string()
      .optional()
      .describe(
        'If VERIFIED, include the exact sandbox_exec command used. If UNVERIFIED, include what you would run.'
      ),
    evidence: z
      .string()
      .optional()
      .describe(
        'If VERIFIED, include key output that demonstrates the bug. If UNVERIFIED, include the reason verification was not possible.'
      ),
  }),
  execute: async () => {
    return 'Bug recorded.'
  },
})
