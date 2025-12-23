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
  type: 'status' | 'error' | 'files' | 'step' | 'complete' | 'sandbox_request' | 'ping'
  message?: string
  files?: string[]
  step?: Step
  result?: string
  requestId?: string
  command?: string
  cwd?: string
  timeout?: number
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
}
