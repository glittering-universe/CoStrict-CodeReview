import { Icon } from '@iconify/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Log } from '../types'

type SandboxRunChunk = {
  stream: 'system' | 'stdout' | 'stderr'
  text: string
}

type SandboxRun = {
  runId: string
  command: string
  cwd: string
  timeout: number
  preserveSandbox: boolean
  status?: string
  exitCode?: number | string | null
  signal?: string | null
  durationMs?: number
  sandboxRoot?: string
  sandboxCwd?: string
  truncated?: boolean
  errorMessage?: string
  startedAt?: number
  endedAt?: number
  chunks: SandboxRunChunk[]
}

const ensureRun = (runs: Map<string, SandboxRun>, runId: string): SandboxRun => {
  const existing = runs.get(runId)
  if (existing) return existing
  const created: SandboxRun = {
    runId,
    command: '',
    cwd: '',
    timeout: 0,
    preserveSandbox: false,
    chunks: [],
  }
  runs.set(runId, created)
  return created
}

const buildRuns = (logs: Log[]): SandboxRun[] => {
  const runs = new Map<string, SandboxRun>()

  for (const log of logs) {
    if (!log.runId) continue
    if (
      log.type !== 'sandbox_run_start' &&
      log.type !== 'sandbox_run_output' &&
      log.type !== 'sandbox_run_end'
    ) {
      continue
    }

    const run = ensureRun(runs, log.runId)

    if (log.type === 'sandbox_run_start') {
      run.command = log.command ?? run.command
      run.cwd = log.cwd ?? run.cwd
      run.timeout = typeof log.timeout === 'number' ? log.timeout : run.timeout
      run.preserveSandbox =
        typeof log.preserveSandbox === 'boolean'
          ? log.preserveSandbox
          : run.preserveSandbox
      run.startedAt = log.timestamp
      continue
    }

    if (log.type === 'sandbox_run_output') {
      const text = log.text ?? ''
      if (!text) continue
      const stream = log.stream ?? 'system'
      const last = run.chunks[run.chunks.length - 1]
      if (last && last.stream === stream) {
        last.text += text
      } else {
        run.chunks.push({ stream, text })
      }
      continue
    }

    if (log.type === 'sandbox_run_end') {
      run.status = log.status ?? run.status
      run.exitCode = log.exitCode ?? run.exitCode
      run.signal = log.signal ?? run.signal
      run.durationMs = log.durationMs ?? run.durationMs
      run.sandboxRoot = log.sandboxRoot ?? run.sandboxRoot
      run.sandboxCwd = log.sandboxCwd ?? run.sandboxCwd
      run.truncated = log.truncated ?? run.truncated
      run.errorMessage = log.errorMessage ?? run.errorMessage
      run.endedAt = log.timestamp
    }
  }

  return Array.from(runs.values()).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}

const formatDuration = (ms: number | undefined) => {
  if (!ms) return '--'
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}m ${remainder}s`
}

const formatRunLabel = (run: SandboxRun, index: number) => {
  const command = run.command ? run.command.replace(/\s+/g, ' ').trim() : 'sandbox_exec'
  return `#${index + 1} ${command.length > 48 ? `${command.slice(0, 47)}…` : command}`
}

const statusLabel = (status?: string) => {
  const normalized = (status ?? '').toLowerCase()
  switch (normalized) {
    case 'success':
      return { label: '成功', variant: 'ok' as const }
    case 'nonzero':
      return { label: '非 0 退出', variant: 'warn' as const }
    case 'timed_out':
      return { label: '超时', variant: 'warn' as const }
    case 'denied':
      return { label: '已拒绝', variant: 'warn' as const }
    case 'dangerous':
      return { label: '已拦截', variant: 'warn' as const }
    case 'error':
      return { label: '错误', variant: 'warn' as const }
    default:
      return { label: '运行中', variant: 'neutral' as const }
  }
}

interface SandboxTerminalProps {
  logs: Log[]
}

export function SandboxTerminal({ logs }: SandboxTerminalProps) {
  const runs = useMemo(() => buildRuns(logs), [logs])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  const terminalRef = useRef<HTMLDivElement | null>(null)
  const [shouldFollow, setShouldFollow] = useState(true)

  useEffect(() => {
    if (runs.length === 0) {
      setActiveRunId(null)
      return
    }

    if (activeRunId && runs.some((run) => run.runId === activeRunId)) return
    setActiveRunId(runs[runs.length - 1]?.runId ?? null)
  }, [activeRunId, runs])

  const activeRun = useMemo(() => {
    if (!activeRunId) return runs[runs.length - 1] ?? null
    return runs.find((run) => run.runId === activeRunId) ?? runs[runs.length - 1] ?? null
  }, [activeRunId, runs])

  const isNearBottom = () => {
    const node = terminalRef.current
    if (!node) return true
    const threshold = 48
    return node.scrollHeight - node.scrollTop - node.clientHeight <= threshold
  }

  const onScroll = () => {
    setShouldFollow(isNearBottom())
  }

  const scrollToken = `${activeRun?.runId ?? 'none'}:${activeRun?.chunks.length ?? 0}:${activeRun?.endedAt ?? 0}`

  useEffect(() => {
    void scrollToken
    const node = terminalRef.current
    if (!node) return
    if (!shouldFollow) return
    node.scrollTop = node.scrollHeight
  }, [scrollToken, shouldFollow])

  const status = statusLabel(activeRun?.status)

  return (
    <div className="terminal-card">
      <div className="terminal-card-header">
        <div>
          <p className="terminal-title">沙盒终端</p>
          <p className="terminal-subtitle">实时跟踪 sandbox_exec 的执行过程与输出</p>
        </div>

        {runs.length > 1 ? (
          <div className="terminal-controls">
            <Icon icon="lucide:layers" width={16} height={16} />
            <select
              className="terminal-runSelect"
              value={activeRunId ?? runs[runs.length - 1]?.runId ?? ''}
              onChange={(event) => setActiveRunId(event.target.value)}
              aria-label="Select sandbox run"
            >
              {runs.map((run, index) => (
                <option key={run.runId} value={run.runId}>
                  {formatRunLabel(run, index)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {activeRun ? (
        <>
          <div className="terminal-metaRow">
            <span
              className={`tool-pill ${
                status.variant === 'ok'
                  ? 'tool-pill--ok'
                  : status.variant === 'warn'
                    ? 'tool-pill--warn'
                    : ''
              }`}
            >
              {status.label}
            </span>
            <span className="tool-pill">
              <Icon icon="lucide:clock-3" width={14} height={14} />
              {formatDuration(activeRun.durationMs)}
            </span>
            {activeRun.exitCode !== undefined ? (
              <span className="tool-pill">
                Exit {String(activeRun.exitCode)}
                {activeRun.signal ? ` (${activeRun.signal})` : ''}
              </span>
            ) : null}
            {activeRun.truncated ? <span className="tool-pill">Truncated</span> : null}
          </div>

          <div className="terminal-body" ref={terminalRef} onScroll={onScroll}>
            <div className="terminal-pre" role="log" aria-label="Sandbox terminal output">
              {activeRun.chunks.length === 0 ? (
                <span className="terminal-chunk terminal-chunk--system">
                  (等待输出...)
                </span>
              ) : (
                activeRun.chunks.map((chunk, index) => (
                  <span
                    key={`${activeRun.runId}:${index}`}
                    className={`terminal-chunk terminal-chunk--${chunk.stream}`}
                  >
                    {chunk.text}
                  </span>
                ))
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="terminal-empty">
          <Icon icon="lucide:terminal" width={18} height={18} />
          <span>尚未运行沙盒验证；当代理调用 sandbox_exec 时，这里会显示实时输出。</span>
        </div>
      )}
    </div>
  )
}
