import { motion, AnimatePresence } from 'framer-motion'
import { ChevronUp, ChevronDown, XCircle } from 'lucide-react'
import type { Log } from '../types'

const formatJson = (raw: string) => {
    try {
        const parsed = JSON.parse(raw)
        return JSON.stringify(parsed, null, 2)
    } catch {
        return raw
    }
}

const extractJsonBlocks = (text?: string) => {
    if (!text) return { cleanText: '', jsonBlocks: [] as string[] }
    const jsonBlocks: string[] = []
    let cleanText = ''
    let i = 0

    while (i < text.length) {
        if (text[i] === '{') {
            let depth = 0
            let j = i
            while (j < text.length) {
                if (text[j] === '{') depth++
                else if (text[j] === '}') {
                    depth--
                    if (depth === 0) {
                        j++
                        break
                    }
                }
                j++
            }

            if (depth === 0) {
                const candidate = text.slice(i, j)
                try {
                    JSON.parse(candidate)
                    jsonBlocks.push(candidate)
                    i = j
                    continue
                } catch {
                    // fall through to treat as text
                }
            }
        }

        cleanText += text[i]
        i++
    }

    return { cleanText: cleanText.trim(), jsonBlocks }
}

interface LogItemProps {
    log: Log
    index: number
    displayableIndex: number
    isExpanded: boolean
    toggleStep: (index: number) => void
}

export function LogItem({ log, index, displayableIndex, isExpanded, toggleStep }: LogItemProps) {
    const formatToolArgs = (args: unknown) => {
        if (args === undefined || args === null) return '未提供参数。'
        if (typeof args === 'string') return args
        try {
            return JSON.stringify(args, null, 2)
        } catch {
            return String(args)
        }
    }

    if (log.type === 'status') {
        const { cleanText, jsonBlocks } = extractJsonBlocks(log.message)
        return (
            <motion.div
                key={log.timestamp + index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="progress-step-row"
            >
                <div className="progress-step-number">{displayableIndex}</div>
                <div className="progress-step-content">
                    {cleanText || log.message}
                    {jsonBlocks.length > 0 && (
                        <div className="json-snippet-group">
                            {jsonBlocks.map((block, idx) => (
                                <pre key={idx} className="json-snippet">
                                    {formatJson(block)}
                                </pre>
                            ))}
                        </div>
                    )}
                </div>
            </motion.div>
        )
    }

    if (log.type === 'files') {
        return (
            <motion.div
                key={log.timestamp + index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="progress-step-row"
            >
                <div className="progress-step-number">{displayableIndex}</div>
                <div className="progress-step-content">
                    发现 {log.files?.length} 个文件待审查
                </div>
            </motion.div>
        )
    }

    if (log.type === 'step' && log.step) {
        const toolCount = log.step.toolCalls?.length || 0

        const { cleanText, jsonBlocks } = extractJsonBlocks(log.step.text)
        const displayText = cleanText || log.step.text || `处理包含 ${toolCount} 个工具${toolCount !== 1 ? 's' : ''} 的步骤`

        return (
            <motion.div
                key={log.timestamp + index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="progress-step-row"
            >
                <div className="progress-step-number">{displayableIndex}</div>
                <div className="progress-step-content flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                            {displayText}
                            {toolCount > 0 && (
                                <div className="log-meta">
                                    <span className="tool-pill">{toolCount} 个工具{toolCount !== 1 ? 's' : ''}</span>
                                </div>
                            )}
                            {jsonBlocks.length > 0 && (
                                <div className="json-snippet-group">
                                    {jsonBlocks.map((block, idx) => (
                                        <pre key={idx} className="json-snippet">
                                            {formatJson(block)}
                                        </pre>
                                    ))}
                                </div>
                            )}
                        </div>
                        {toolCount > 0 && (
                            <button
                                onClick={() => toggleStep(index)}
                                className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors flex items-center gap-1"
                            >
                                {isExpanded ? (
                                    <ChevronUp className="w-4 h-4" />
                                ) : (
                                    <ChevronDown className="w-4 h-4" />
                                )}
                            </button>
                        )}
                    </div>
                    <AnimatePresence>
                        {isExpanded && log.step.toolCalls && toolCount > 0 && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden mt-2 pt-2 border-t border-[var(--card-border)]"
                            >
                                <div className="space-y-3">
                                    {log.step.toolCalls.map((tool, j) => (
                                        <div key={`${tool.toolName ?? 'tool'}-${j}`} className="tool-detail-card">
                                            <div className="tool-detail-header">
                                                <span>{tool.toolName ?? `工具 ${j + 1}`}</span>
                                                <span className="tool-pill">调用 #{j + 1}</span>
                                            </div>
                                            <pre className="tool-detail-body">
                                                {formatToolArgs(tool.args)}
                                            </pre>
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        )
    }

    if (log.type === 'error') {
        return (
            <motion.div
                key={log.timestamp + index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="progress-step-row border-[var(--error)]"
            >
                <div className="progress-step-number bg-red-500 bg-opacity-20">{displayableIndex}</div>
                <div className="progress-step-content text-[var(--error)]">
                    <div className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{log.message}</span>
                    </div>
                </div>
            </motion.div>
        )
    }

    return null
}
