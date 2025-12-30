import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { tool } from 'ai'
import { z } from 'zod'

const execAsync = promisify(exec)
const resolveMaxOutputChars = (): number => {
  const raw = process.env.COSTRICT_MAX_BASH_OUTPUT_CHARS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 20_000
}

const truncateWithMessage = (input: string, maxChars: number): string => {
  if (input.length <= maxChars) return input
  const headChars = Math.max(0, Math.floor(maxChars * 0.8))
  const tailChars = Math.max(0, maxChars - headChars)
  const head = input.slice(0, headChars)
  const tail = input.slice(-tailChars)
  return `${head}\n\n... [output truncated: ${input.length} chars total, showing ${headChars}+${tailChars}] ...\n\n${tail}`
}

export const bashTool = tool({
  description:
    'Execute a bash command and get its output. Use this tool to run commands such as git commands to step through changes made to get to the current state of the codebase or to run tests or build scripts.',
  parameters: z.object({
    command: z.string().describe('The bash command to execute'),
    cwd: z
      .string()
      .describe(
        'The working directory for the command. Default is the current directory.'
      )
      .default('.'),
    timeout: z
      .number()
      .describe('Timeout in milliseconds before the command is killed')
      .default(10000),
  }),
  execute: async ({ command, cwd, timeout }) => {
    try {
      // Prevent potential harmful commands
      const dangerousCommands = ['rm -rf', 'mkfs', 'dd', ':(){', 'wget', 'curl']
      for (const dangerous of dangerousCommands) {
        if (command.includes(dangerous)) {
          return `Error: Potentially dangerous command detected: ${dangerous}`
        }
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB output buffer
      })

      let output = ''

      if (stdout) {
        output += `STDOUT:\n${stdout}\n`
      }

      if (stderr) {
        output += `STDERR:\n${stderr}\n`
      }

      if (!output) {
        output = 'Command executed successfully with no output.'
      }

      return truncateWithMessage(output, resolveMaxOutputChars())
    } catch (error) {
      if (error instanceof Error) {
        if ('code' in error && 'killed' in error && error.killed) {
          return `Command timed out after ${timeout}ms`
        }
        return `Error executing command: ${error.message}`
      }
      return 'Unknown error executing command'
    }
  },
})
