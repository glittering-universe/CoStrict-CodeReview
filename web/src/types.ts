export type Step = {
    toolCalls?: { toolName: string; args: any }[]
    text?: string
    usage?: any
}

export type Log = {
    type: 'status' | 'error' | 'files' | 'step' | 'complete'
    message?: string
    files?: string[]
    step?: Step
    result?: string
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
