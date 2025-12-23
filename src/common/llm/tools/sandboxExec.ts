import { exec } from 'node:child_process'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { confirm } from '@inquirer/prompts'
import { tool } from 'ai'
import { z } from 'zod'
import { getGitRoot } from '../../git/getChangedFilesNames'

const execAsync = promisify(exec)
const DEFAULT_TIMEOUT = 10000
const IGNORED_DIRS = new Set(['.git', 'node_modules'])
const DANGEROUS_COMMANDS = [
  'rm -rf',
  'mkfs',
  'dd',
  ':(){',
  'wget',
  'curl',
  'sudo',
  'chmod 777',
  'chown',
  'shutdown',
  'reboot',
  'mount',
  'umount',
  'docker',
  'podman',
]

export type SandboxExecApprovalRequest = {
  command: string
  cwd: string
  timeout: number
}

export type SandboxExecApprovalResponse = {
  approved: boolean
  reason?: string
}

export type SandboxExecConfirm = (
  request: SandboxExecApprovalRequest
) => Promise<SandboxExecApprovalResponse>

const findDangerousCommand = (command: string): string | undefined => {
  return DANGEROUS_COMMANDS.find((dangerous) => command.includes(dangerous))
}

const defaultConfirmSandboxExec: SandboxExecConfirm = async ({ command, cwd }) => {
  if (!process.stdin?.isTTY) {
    return {
      approved: false,
      reason: 'Non-interactive session; unable to prompt for approval.',
    }
  }

  const approved = await confirm({
    message: `Approve sandbox_exec?\nCommand: ${command}\nWorking dir: ${cwd}`,
    default: false,
  })

  return approved
    ? { approved: true }
    : { approved: false, reason: 'User denied sandbox execution.' }
}

const resolveSandboxRoot = async (cwd: string): Promise<string> => {
  try {
    return await getGitRoot()
  } catch {
    return path.resolve(cwd)
  }
}

const resolveSandboxCwd = (
  baseDir: string,
  requestedCwd: string,
  sandboxRoot: string
): string => {
  const resolvedCwd = path.isAbsolute(requestedCwd)
    ? requestedCwd
    : path.resolve(baseDir, requestedCwd)
  const relativeCwd = path.relative(baseDir, resolvedCwd)

  if (relativeCwd.startsWith('..') || path.isAbsolute(relativeCwd)) {
    return sandboxRoot
  }

  return path.join(sandboxRoot, relativeCwd)
}

const formatOutput = (
  sandboxRoot: string,
  sandboxCwd: string,
  stdout?: string,
  stderr?: string
): string => {
  const sections: string[] = [`Sandbox root: ${sandboxRoot}`]

  if (sandboxCwd !== sandboxRoot) {
    sections.push(`Sandbox cwd: ${sandboxCwd}`)
  }

  if (stdout) {
    sections.push(`STDOUT:\n${stdout}`)
  }

  if (stderr) {
    sections.push(`STDERR:\n${stderr}`)
  }

  if (!stdout && !stderr) {
    sections.push('Command executed successfully with no output.')
  }

  return sections.join('\n')
}

export const createSandboxExecTool = (confirmSandboxExec = defaultConfirmSandboxExec) =>
  tool({
    description:
      'Execute a bash command inside a temporary sandbox copy of the repository for vulnerability verification. Requires explicit user approval each time. The sandbox excludes .git and node_modules; install dependencies inside the sandbox if needed.',
    parameters: z.object({
      command: z.string().describe('The bash command to execute'),
      cwd: z
        .string()
        .describe(
          'Working directory for the command, relative to the repository root. Defaults to the repo root.'
        )
        .default('.'),
      timeout: z
        .number()
        .describe('Timeout in milliseconds before the command is killed')
        .default(DEFAULT_TIMEOUT),
      preserveSandbox: z
        .boolean()
        .describe('Whether to keep the sandbox directory for inspection')
        .default(false),
    }),
    execute: async ({ command, cwd, timeout, preserveSandbox }) => {
      const dangerous = findDangerousCommand(command)
      if (dangerous) {
        return `Error: Potentially dangerous command detected: ${dangerous}`
      }

      const approval = await confirmSandboxExec({ command, cwd, timeout })
      if (!approval.approved) {
        return `Sandbox execution denied. ${approval.reason ?? 'Approval required.'}`
      }

      let sandboxRoot = ''

      try {
        const baseDir = await resolveSandboxRoot(cwd)
        sandboxRoot = await mkdtemp(path.join(tmpdir(), 'shippie-sandbox-'))

        await cp(baseDir, sandboxRoot, {
          recursive: true,
          filter: (source) => !IGNORED_DIRS.has(path.basename(source)),
        })

        const sandboxCwd = resolveSandboxCwd(baseDir, cwd, sandboxRoot)
        const { stdout, stderr } = await execAsync(command, {
          cwd: sandboxCwd,
          timeout,
          maxBuffer: 1024 * 1024,
        })

        return formatOutput(sandboxRoot, sandboxCwd, stdout, stderr)
      } catch (error) {
        if (error instanceof Error) {
          const timedOut =
            'killed' in error && (error as Error & { killed?: boolean }).killed
          if (timedOut) {
            return `Command timed out after ${timeout}ms`
          }

          return `Error executing command: ${error.message}`
        }
        return 'Unknown error executing command'
      } finally {
        if (sandboxRoot && !preserveSandbox) {
          try {
            await rm(sandboxRoot, { recursive: true, force: true })
          } catch {
            // Best-effort cleanup; ignore failures.
          }
        }
      }
    },
  })

export const sandboxExecTool = createSandboxExecTool()
