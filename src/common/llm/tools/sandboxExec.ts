import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { confirm } from '@inquirer/prompts'
import { type ToolExecutionOptions, tool } from 'ai'
import { z } from 'zod'
import { getGitRoot } from '../../git/getChangedFilesNames'

const DEFAULT_TIMEOUT = 120000
const IGNORED_DIRS = new Set(['.git', 'node_modules'])
const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024
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
  toolCallId?: string
}

export type SandboxExecApprovalResponse = {
  approved: boolean
  reason?: string
}

export type SandboxExecConfirm = (
  request: SandboxExecApprovalRequest
) => Promise<SandboxExecApprovalResponse>

export type SandboxRunStream = 'system' | 'stdout' | 'stderr'

export type SandboxRunStatus =
  | 'success'
  | 'nonzero'
  | 'timed_out'
  | 'denied'
  | 'dangerous'
  | 'error'

export type SandboxExecStreamEvent =
  | {
      type: 'sandbox_run_start'
      runId: string
      toolCallId: string
      command: string
      cwd: string
      timeout: number
      preserveSandbox: boolean
    }
  | {
      type: 'sandbox_run_output'
      runId: string
      toolCallId: string
      stream: SandboxRunStream
      text: string
    }
  | {
      type: 'sandbox_run_end'
      runId: string
      toolCallId: string
      status: SandboxRunStatus
      exitCode: number | string | null
      signal: string | null
      durationMs: number
      sandboxRoot?: string
      sandboxCwd?: string
      truncated?: boolean
      errorMessage?: string
    }

export type SandboxExecOnEvent = (event: SandboxExecStreamEvent) => void | Promise<void>

type CachedSandboxRun = {
  output: string
  summary: string
  duplicateCount: number
  status: SandboxRunStatus
  exitCode: number | string | null
  signal: string | null
  truncated: boolean
}

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
  stderr?: string,
  meta?: { command?: string; exitCode?: number | string; signal?: string | null }
): string => {
  const sections: string[] = [`Sandbox root: ${sandboxRoot}`]

  if (sandboxCwd !== sandboxRoot) {
    sections.push(`Sandbox cwd: ${sandboxCwd}`)
  }

  if (meta?.command) {
    sections.push(`Command: ${meta.command}`)
  }

  if (meta?.exitCode !== undefined || meta?.signal) {
    sections.push(
      `Exit: ${meta.exitCode !== undefined ? String(meta.exitCode) : 'unknown'}${
        meta.signal ? ` (signal: ${meta.signal})` : ''
      }`
    )
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

const formatCacheSummary = (meta: {
  exitCode?: number | string
  signal?: string | null
  timedOut?: boolean
  truncated?: boolean
}): string => {
  if (meta.timedOut) {
    return `timed out (exit: ${meta.exitCode ?? 'timeout'})${meta.signal ? ` signal=${meta.signal}` : ''}`
  }

  const exitPart = meta.exitCode !== undefined ? String(meta.exitCode) : 'unknown'
  return `exit=${exitPart}${meta.signal ? ` signal=${meta.signal}` : ''}${
    meta.truncated ? ' (output truncated)' : ''
  }`
}

const appendWithLimit = (
  current: string,
  addition: string,
  limit: number
): { next: string; truncated: boolean } => {
  if (addition.length === 0) return { next: current, truncated: false }
  if (current.length >= limit) return { next: current, truncated: true }
  const remaining = limit - current.length
  if (addition.length <= remaining) {
    return { next: current + addition, truncated: false }
  }
  return { next: current + addition.slice(0, remaining), truncated: true }
}

const runBashCommandStreaming = async (options: {
  command: string
  cwd: string
  timeout: number
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}): Promise<{
  stdout: string
  stderr: string
  exitCode: number | string | null
  signal: string | null
  timedOut: boolean
  truncated: boolean
}> => {
  return new Promise((resolve) => {
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let truncated = false
    let exitCode: number | string | null = null
    let signal: string | null = null
    let settled = false

    const child = spawn('bash', ['-lc', options.command], {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const settle = () => {
      if (settled) return
      settled = true
      resolve({ stdout, stderr, exitCode, signal, timedOut, truncated })
    }

    const killChild = (killSignal: NodeJS.Signals) => {
      try {
        child.kill(killSignal)
      } catch {
        // ignore
      }
    }

    const timeoutHandle = setTimeout(() => {
      timedOut = true
      const warning = `\n[costrict] Command timed out after ${options.timeout}ms\n`
      const appended = appendWithLimit(stderr, warning, DEFAULT_MAX_BUFFER)
      const emitted = appended.next.slice(stderr.length)
      stderr = appended.next
      truncated = truncated || appended.truncated
      if (emitted) {
        options.onStderr?.(emitted)
      }
      killChild('SIGTERM')
      setTimeout(() => killChild('SIGKILL'), 5000)
    }, options.timeout)

    child.on('error', (error) => {
      clearTimeout(timeoutHandle)
      const message = error instanceof Error ? error.message : String(error)
      const appended = appendWithLimit(stderr, `${message}\n`, DEFAULT_MAX_BUFFER)
      const emitted = appended.next.slice(stderr.length)
      stderr = appended.next
      truncated = truncated || appended.truncated
      if (emitted) {
        options.onStderr?.(emitted)
      }
      exitCode = 'spawn_error'
      settle()
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk)
      if (!text) return
      const appended = appendWithLimit(stdout, text, DEFAULT_MAX_BUFFER)
      const emitted = appended.next.slice(stdout.length)
      stdout = appended.next
      truncated = truncated || appended.truncated
      if (emitted) {
        options.onStdout?.(emitted)
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk)
      if (!text) return
      const appended = appendWithLimit(stderr, text, DEFAULT_MAX_BUFFER)
      const emitted = appended.next.slice(stderr.length)
      stderr = appended.next
      truncated = truncated || appended.truncated
      if (emitted) {
        options.onStderr?.(emitted)
      }
    })

    child.on('close', (code, closeSignal) => {
      clearTimeout(timeoutHandle)
      exitCode = code ?? null
      signal = closeSignal

      const stdoutTail = stdoutDecoder.end()
      if (stdoutTail) {
        const appended = appendWithLimit(stdout, stdoutTail, DEFAULT_MAX_BUFFER)
        const emitted = appended.next.slice(stdout.length)
        stdout = appended.next
        truncated = truncated || appended.truncated
        if (emitted) {
          options.onStdout?.(emitted)
        }
      }

      const stderrTail = stderrDecoder.end()
      if (stderrTail) {
        const appended = appendWithLimit(stderr, stderrTail, DEFAULT_MAX_BUFFER)
        const emitted = appended.next.slice(stderr.length)
        stderr = appended.next
        truncated = truncated || appended.truncated
        if (emitted) {
          options.onStderr?.(emitted)
        }
      }

      settle()
    })
  })
}

export const createSandboxExecTool = (
  confirmSandboxExec = defaultConfirmSandboxExec,
  onEvent?: SandboxExecOnEvent
) => {
  const cachedRuns = new Map<string, CachedSandboxRun>()

  return tool({
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
    execute: async (
      { command, cwd, timeout, preserveSandbox },
      options: ToolExecutionOptions
    ) => {
      const cacheKey = `${cwd}\n${timeout}\n${command}`
      const toolCallId = options?.toolCallId ?? crypto.randomUUID()
      const runId = toolCallId
      const startedAt = Date.now()
      type SandboxRunEndEvent = Extract<
        SandboxExecStreamEvent,
        { type: 'sandbox_run_end' }
      >
      let endEmitted = false
      let startEmitted = false

      const emit = (event: SandboxExecStreamEvent) => {
        if (!onEvent) return
        try {
          void onEvent(event)
        } catch {
          // ignore
        }
      }

      const emitStart = () => {
        if (startEmitted) return
        startEmitted = true
        emit({
          type: 'sandbox_run_start',
          runId,
          toolCallId,
          command,
          cwd,
          timeout,
          preserveSandbox,
        })
      }

      const emitSystem = (text: string) => {
        emit({ type: 'sandbox_run_output', runId, toolCallId, stream: 'system', text })
      }

      const emitEnd = (
        event: Omit<SandboxRunEndEvent, 'type' | 'runId' | 'toolCallId' | 'durationMs'>
      ) => {
        if (endEmitted) return
        emitStart()
        endEmitted = true
        emit({
          type: 'sandbox_run_end',
          runId,
          toolCallId,
          durationMs: Date.now() - startedAt,
          ...event,
        })
      }

      const cached = cachedRuns.get(cacheKey)

      const dangerous = findDangerousCommand(command)
      if (dangerous) {
        emitStart()
        emitSystem(`Blocked potentially dangerous command: ${dangerous}\n`)
        emitEnd({
          status: 'dangerous',
          exitCode: null,
          signal: null,
        })
        return `Error: Potentially dangerous command detected: ${dangerous}`
      }

      const approval = await confirmSandboxExec({ command, cwd, timeout, toolCallId })
      if (!approval.approved) {
        emitStart()
        emitSystem(
          `Sandbox execution denied. ${approval.reason ?? 'Approval required.'}\n`
        )
        emitEnd({
          status: 'denied',
          exitCode: null,
          signal: null,
        })
        return [
          `Sandbox execution denied. ${approval.reason ?? 'Approval required.'}`,
          '',
          'DO NOT retry the same command in a loop. Mark the finding as UNVERIFIED (reason: sandbox approval denied or timed out) and proceed.',
        ].join('\n')
      }

      if (cached) {
        emitStart()
        cached.duplicateCount += 1
        emitSystem(
          '[costrict] Using cached sandbox_exec output (identical command, approved).\n'
        )
        emitSystem(`${cached.output}\n`)
        emitEnd({
          status: cached.status,
          exitCode: cached.exitCode,
          signal: cached.signal,
          truncated: cached.truncated,
        })
        return [
          'Cached sandbox_exec result (identical command).',
          `Previous summary: ${cached.summary}`,
          '',
          cached.output,
        ].join('\n')
      }

      emitStart()
      let sandboxRoot = ''
      let sandboxCwd = ''
      let finalOutput = ''
      let endEvent: Omit<
        SandboxRunEndEvent,
        'type' | 'runId' | 'toolCallId' | 'durationMs'
      > = {
        status: 'error',
        exitCode: null,
        signal: null,
      }

      try {
        const baseDir = await resolveSandboxRoot(cwd)
        emitSystem('Creating sandbox directory...\n')
        sandboxRoot = await mkdtemp(path.join(tmpdir(), 'costrict-sandbox-'))
        emitSystem(`Sandbox directory: ${sandboxRoot}\n`)

        emitSystem(
          'Copying repository into sandbox (excluding .git and node_modules)...\n'
        )
        await cp(baseDir, sandboxRoot, {
          recursive: true,
          filter: (source) => !IGNORED_DIRS.has(path.basename(source)),
        })
        emitSystem('Copy completed.\n')

        sandboxCwd = resolveSandboxCwd(baseDir, cwd, sandboxRoot)
        emitSystem(`Working directory: ${sandboxCwd}\n`)
        emitSystem(`$ ${command}\n`)
        const { stdout, stderr, exitCode, signal, timedOut, truncated } =
          await runBashCommandStreaming({
            command,
            cwd: sandboxCwd,
            timeout,
            onStdout: (chunk) => {
              emit({
                type: 'sandbox_run_output',
                runId,
                toolCallId,
                stream: 'stdout',
                text: chunk,
              })
            },
            onStderr: (chunk) => {
              emit({
                type: 'sandbox_run_output',
                runId,
                toolCallId,
                stream: 'stderr',
                text: chunk,
              })
            },
          })

        const metaExitCode: number | string = timedOut
          ? 'timeout'
          : typeof exitCode === 'number' || typeof exitCode === 'string'
            ? exitCode
            : 'unknown'

        const formatted = formatOutput(sandboxRoot, sandboxCwd, stdout, stderr, {
          command,
          exitCode: metaExitCode,
          signal,
        })

        if (timedOut) {
          finalOutput = [`Command timed out after ${timeout}ms`, formatted].join('\n')
        } else if (typeof exitCode === 'number' && exitCode !== 0) {
          finalOutput = [
            'Command completed with a non-zero exit (this is output, not a sandbox error).',
            formatted,
            '',
            'Interpret this result and proceed. Do NOT rerun the same sandbox_exec command again.',
          ].join('\n')
        } else if (exitCode === 'spawn_error' || exitCode === null) {
          finalOutput = ['Error executing command.', formatted].join('\n')
        } else {
          finalOutput = formatted
        }

        if (truncated) {
          emitSystem('\n[costrict] Output truncated (too large).\n')
          finalOutput = `${finalOutput}\n\n[costrict] Output truncated (too large).`
        }

        const status: SandboxRunStatus = timedOut
          ? 'timed_out'
          : typeof exitCode === 'number'
            ? exitCode === 0
              ? 'success'
              : 'nonzero'
            : exitCode === null || exitCode === 'spawn_error'
              ? 'error'
              : 'nonzero'

        endEvent = {
          status,
          exitCode: metaExitCode,
          signal,
          sandboxRoot,
          sandboxCwd,
          truncated,
        }

        cachedRuns.set(cacheKey, {
          output: finalOutput,
          summary: formatCacheSummary({
            exitCode: metaExitCode,
            signal,
            timedOut,
            truncated,
          }),
          duplicateCount: 0,
          status,
          exitCode: metaExitCode,
          signal,
          truncated,
        })
      } catch (error) {
        if (error instanceof Error) {
          finalOutput = `Error executing command: ${error.message}`
          endEvent = {
            status: 'error',
            exitCode: null,
            signal: null,
            sandboxRoot: sandboxRoot || undefined,
            sandboxCwd: sandboxCwd || undefined,
            errorMessage: error.message,
          }
        } else {
          finalOutput = 'Unknown error executing command'
          endEvent = {
            status: 'error',
            exitCode: null,
            signal: null,
            sandboxRoot: sandboxRoot || undefined,
            sandboxCwd: sandboxCwd || undefined,
            errorMessage: 'Unknown error executing command',
          }
        }
      } finally {
        if (sandboxRoot && !preserveSandbox) {
          emitSystem('Cleaning up sandbox directory...\n')
          try {
            await rm(sandboxRoot, { recursive: true, force: true })
          } catch {
            // Best-effort cleanup; ignore failures.
          }
        } else if (sandboxRoot && preserveSandbox) {
          emitSystem(`Sandbox preserved at: ${sandboxRoot}\n`)
        }
      }

      emitEnd(endEvent)
      return finalOutput
    },
  })
}

export const sandboxExecTool = createSandboxExecTool()
