export type Step = {
  toolCalls?: Array<{
    type?: string
    toolCallId?: string
    toolName?: string
    args: unknown
  }>
  toolResults?: Array<{
    type?: string
    toolCallId?: string
    toolName?: string
    args?: unknown
    result: unknown
  }>
  text?: string
  usage?: unknown
}

export type SandboxRequest = {
  requestId: string
  command: string
  cwd: string
  timeout?: number
}

export type Log = {
  type:
    | 'status'
    | 'error'
    | 'files'
    | 'step'
    | 'complete'
    | 'subagent_preflight'
    | 'sandbox_request'
    | 'sandbox_run_start'
    | 'sandbox_run_output'
    | 'sandbox_run_end'
    | 'ping'
  message?: string
  files?: string[]
  step?: Step
  result?: string
  state?: 'start' | 'end'
  total?: number
  requestId?: string
  toolCallId?: string
  command?: string
  cwd?: string
  timeout?: number
  preserveSandbox?: boolean
  runId?: string
  stream?: 'system' | 'stdout' | 'stderr'
  text?: string
  status?: string
  exitCode?: number | string | null
  signal?: string | null
  durationMs?: number
  sandboxRoot?: string
  sandboxCwd?: string
  truncated?: boolean
  errorMessage?: string
  timestamp: number
}

export type ReviewSession = {
  id: string
  modelString: string
  logs: Log[]
  files: string[]
  finalResult: string | null
  isReviewing: boolean
  startTime: number
  completedAt?: number
  subagentsRunning?: boolean
  subagentsTotal?: number
  target?: { kind: 'local'; repoPath?: string } | { kind: 'github'; prUrl: string }
  githubCommentStatus?: 'idle' | 'auth' | 'posting' | 'done' | 'error'
  githubCommentUrl?: string
  githubCommentError?: string
}
