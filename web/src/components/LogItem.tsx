import { Icon } from '@iconify/react'
import { AnimatePresence, motion } from 'framer-motion'
import { type SyntheticEvent, useEffect, useMemo, useState } from 'react'
import type { Log } from '../types'
import { SandboxTerminal } from './SandboxTerminal'

const formatJson = (raw: string) => {
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

const normalizeToolNameKey = (rawName: string): string => {
  const trimmed = rawName.trim()
  if (!trimmed) return ''

  return trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isProviderToolCallsChunk = (value: unknown): boolean => {
  if (!isRecord(value)) return false

  if (Array.isArray(value.choices)) {
    return value.choices.some((choice) => isProviderToolCallsChunk(choice))
  }

  const delta = value.delta
  if (!isRecord(delta)) return false
  return Array.isArray(delta.tool_calls)
}

const extractJsonSpan = (
  text: string,
  startIndex: number
): { endIndex: number; json: string } | null => {
  const startChar = text[startIndex]
  if (startChar !== '{' && startChar !== '[') return null

  const stack: Array<'}' | ']'> = [startChar === '{' ? '}' : ']']
  let inString = false
  let escaped = false

  for (let i = startIndex + 1; i < text.length; i += 1) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      stack.push('}')
      continue
    }
    if (ch === '[') {
      stack.push(']')
      continue
    }

    if (ch === '}' || ch === ']') {
      const expected = stack.pop()
      if (!expected || ch !== expected) return null
      if (stack.length === 0) {
        return {
          endIndex: i + 1,
          json: text.slice(startIndex, i + 1),
        }
      }
    }
  }

  return null
}

const extractJsonBlocks = (text?: string) => {
  if (!text) return { cleanText: '', jsonBlocks: [] as string[] }
  const jsonBlocks: string[] = []
  let cleanText = ''
  let i = 0

  while (i < text.length) {
    if (text[i] === '{' || text[i] === '[') {
      const span = extractJsonSpan(text, i)
      if (span) {
        try {
          const parsed = JSON.parse(span.json) as unknown
          if (!isProviderToolCallsChunk(parsed)) {
            jsonBlocks.push(span.json)
          }
          i = span.endIndex
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
  allLogs: Log[]
}

const truncate = (value: string, maxLength: number) => {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`
}

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const getToolIcon = (toolName?: string) => {
  const normalizedName = toolName ? normalizeToolNameKey(toolName) : ''

  switch (normalizedName) {
    case 'read_file':
      return 'lucide:file-text'
    case 'read_diff':
      return 'lucide:git-compare'
    case 'grep':
      return 'lucide:search'
    case 'glob':
      return 'lucide:folder-search'
    case 'ls':
      return 'lucide:folder'
    case 'fetch':
      return 'lucide:cloud'
    case 'bash':
      return 'lucide:terminal'
    case 'sandbox_exec':
      return 'lucide:shield-check'
    case 'spawn_subagent':
      return 'lucide:bot'
    case 'suggest_change':
      return 'lucide:wand-2'
    case 'submit_summary':
      return 'lucide:send'
    case 'report_bug':
      return 'lucide:bug'
    default:
      return 'lucide:tool'
  }
}

const summarizeArgs = (toolName: string | undefined, args: unknown): string => {
  if (typeof args === 'string') return truncate(args, 120)
  if (!isRecord(args)) return ''

  const normalizedName = toolName ? normalizeToolNameKey(toolName) : ''

  const pickValue = (key: string) => {
    const value = args[key]
    return typeof value === 'string' ? value : undefined
  }

  const preferredKeys = (() => {
    switch (normalizedName) {
      case 'bash':
      case 'sandbox_exec':
        return ['command', 'cwd', 'timeout']
      case 'read_file':
      case 'read_diff':
        return ['path', 'startLine', 'endLine']
      case 'grep':
        return ['pattern', 'path']
      case 'glob':
        return ['pattern']
      case 'fetch':
        return ['url', 'method']
      case 'spawn_subagent':
        return ['goal']
      case 'submit_summary':
        return ['report']
      case 'report_bug':
        return ['title']
      default:
        return ['command', 'path', 'pattern', 'cwd', 'url', 'goal', 'report']
    }
  })()

  for (const key of preferredKeys) {
    const value = pickValue(key)
    if (value) return truncate(value.replace(/\s+/g, ' ').trim(), 120)
  }

  const keys = Object.keys(args).slice(0, 4)
  if (keys.length === 0) return ''
  return truncate(keys.join(', '), 120)
}

const normalizeText = (value: unknown): string => {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }
  return safeStringify(value)
}

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(timeout)
  }, [copied])

  const onCopy = async () => {
    if (typeof navigator === 'undefined') return
    try {
      await navigator.clipboard?.writeText(text)
      setCopied(true)
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      className={`copy-btn ${copied ? 'is-copied' : ''}`}
      onClick={onCopy}
      title={copied ? '已复制' : '复制'}
      aria-label={copied ? '已复制' : '复制'}
    >
      <Icon icon={copied ? 'lucide:check' : 'lucide:copy'} width={14} height={14} />
      {copied ? '已复制' : '复制'}
    </button>
  )
}

const KeyValueTable = ({ value }: { value: unknown }) => {
  const rows = useMemo(() => {
    if (!isRecord(value)) return []
    return Object.entries(value).map(([key, entryValue]) => ({ key, value: entryValue }))
  }, [value])

  if (!isRecord(value) || rows.length === 0) {
    return <pre className="tool-detail-body">{normalizeText(value)}</pre>
  }

  return (
    <div className="tool-kv-grid">
      {rows.map((row) => {
        const textValue = normalizeText(row.value)
        const isMultiline = textValue.includes('\n') || textValue.length > 140
        return (
          <div key={row.key} className="tool-kv-row">
            <div className="tool-kv-key">{row.key}</div>
            <div className="tool-kv-value">
              {isMultiline ? (
                <pre className="tool-kv-pre">{textValue}</pre>
              ) : (
                <code className="tool-kv-inline">{textValue}</code>
              )}
              {typeof row.value === 'string' && row.value.trim() ? (
                <CopyButton text={row.value} />
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function LogItem({
  log,
  index,
  displayableIndex,
  isExpanded,
  toggleStep,
  allLogs,
}: LogItemProps) {
  const [detailsOpenState, setDetailsOpenState] = useState<Record<string, boolean>>({})

  const handleDetailsToggle =
    (key: string) => (event: SyntheticEvent<HTMLDetailsElement>) => {
      const target = event.currentTarget
      setDetailsOpenState((prev) => ({ ...prev, [key]: target.open }))
    }

  if (log.type === 'status') {
    const { cleanText, jsonBlocks } = extractJsonBlocks(log.message)
    return (
      <motion.div
        initial={{ opacity: 0.14, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="progress-step-row"
      >
        <div className="progress-step-number">{displayableIndex}</div>
        <div className="progress-step-content">
          {cleanText || log.message}
          {jsonBlocks.length > 0 && (
            <details className="json-snippet-details">
              <summary className="json-snippet-summary">
                <span>结构化数据</span>
                <span className="tool-pill">{jsonBlocks.length} 个 JSON</span>
              </summary>
              <div className="json-snippet-group">
                {jsonBlocks.map((block) => (
                  <pre key={block} className="json-snippet">
                    {formatJson(block)}
                  </pre>
                ))}
              </div>
            </details>
          )}
        </div>
      </motion.div>
    )
  }

  if (log.type === 'files') {
    return (
      <motion.div
        initial={{ opacity: 0.14, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="progress-step-row"
      >
        <div className="progress-step-number">{displayableIndex}</div>
        <div className="progress-step-content">发现 {log.files?.length} 个文件待审查</div>
      </motion.div>
    )
  }

  if (log.type === 'sandbox_request') {
    return (
      <motion.div
        initial={{ opacity: 0.14, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="progress-step-row"
      >
        <div className="progress-step-number">{displayableIndex}</div>
        <div className="progress-step-content">
          <div className="progress-step-top">
            <div className="progress-step-body">
              <div className="log-meta">
                <span className="tool-pill">等待沙盒批准</span>
              </div>
              <div className="sandbox-inline">
                <p className="sandbox-label">命令</p>
                <pre className="sandbox-code sandbox-code--inline">
                  {log.command ?? '未知命令'}
                </pre>
                <p className="sandbox-label">工作目录</p>
                <pre className="sandbox-code sandbox-code--inline">
                  {log.cwd ?? '未知路径'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    )
  }

  if (log.type === 'sandbox_run_start') {
    const runId = log.runId ?? log.toolCallId ?? ''
    const runLogs = runId
      ? allLogs.filter(
          (entry) =>
            entry.runId === runId &&
            (entry.type === 'sandbox_run_start' ||
              entry.type === 'sandbox_run_output' ||
              entry.type === 'sandbox_run_end')
        )
      : [log]

    const toolKey = runId ? `sandbox:${runId}` : `sandbox:${index}`
    const commandSummary = log.command
      ? truncate(log.command.replace(/\s+/g, ' ').trim(), 140)
      : ''
    const cwdSummary = log.cwd ? truncate(log.cwd, 80) : ''

    const toolResult = allLogs
      .filter((entry) => entry.type === 'step' && entry.step?.toolResults)
      .flatMap((entry) =>
        (entry.step?.toolResults ?? []).filter((result) => {
          if (typeof result.toolCallId !== 'string') return false
          return result.toolCallId === runId
        })
      )[0]

    const toolResultText =
      toolResult && typeof toolResult.result === 'string' ? toolResult.result : null

    return (
      <motion.div
        initial={{ opacity: 0.14, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="progress-step-row"
      >
        <div className="progress-step-number">{displayableIndex}</div>
        <div className="progress-step-content">
          <details
            className="tool-call"
            open={detailsOpenState[toolKey] ?? true}
            onToggle={handleDetailsToggle(toolKey)}
          >
            <summary className="tool-call-summary">
              <span className="tool-call-summaryLeft">
                <Icon icon={getToolIcon('sandbox_exec')} width={16} height={16} />
                <span className="tool-call-name">sandbox_exec</span>
              </span>
              {commandSummary ? (
                <span className="tool-call-summaryText">{commandSummary}</span>
              ) : null}
              <span className="tool-pill">调用</span>
            </summary>
            <div className="tool-call-body">
              <div className="tool-call-section">
                <div className="tool-call-sectionHeader">
                  <span>参数</span>
                  <CopyButton
                    text={normalizeText({
                      command: log.command,
                      cwd: log.cwd,
                      timeout: log.timeout,
                      preserveSandbox: log.preserveSandbox,
                    })}
                  />
                </div>
                <KeyValueTable
                  value={{
                    command: log.command,
                    cwd: log.cwd,
                    timeout: log.timeout,
                    preserveSandbox: log.preserveSandbox,
                  }}
                />
                {cwdSummary ? (
                  <div className="log-meta">
                    <span className="tool-pill">cwd: {cwdSummary}</span>
                  </div>
                ) : null}
              </div>

              <SandboxTerminal logs={runLogs} />

              {toolResultText ? (
                <details className="tool-call-result">
                  <summary className="tool-call-resultSummary">
                    <span>工具结果</span>
                  </summary>
                  <div className="tool-call-section">
                    <div className="tool-call-sectionHeader">
                      <span>结果</span>
                      <CopyButton text={toolResultText} />
                    </div>
                    <pre className="tool-detail-body">{toolResultText}</pre>
                  </div>
                </details>
              ) : null}
            </div>
          </details>
        </div>
      </motion.div>
    )
  }

  if (log.type === 'step' && log.step) {
    const allToolCalls = log.step.toolCalls ?? []
    const toolCount = allToolCalls.length
    const primaryTool = toolCount === 1 ? allToolCalls[0] : undefined
    const visibleToolCalls = allToolCalls.filter(
      (tool) => normalizeToolNameKey(tool.toolName ?? '') !== 'sandbox_exec'
    )
    const visibleToolCount = visibleToolCalls.length

    const stableSerialize = (value: unknown) => {
      if (value === undefined) return 'undefined'
      if (value === null) return 'null'
      if (typeof value === 'string') return value
      if (
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
      ) {
        return String(value)
      }
      try {
        return JSON.stringify(value)
      } catch {
        return Object.prototype.toString.call(value)
      }
    }

    const { cleanText, jsonBlocks } = extractJsonBlocks(log.step.text)
    const primaryToolSummary = primaryTool
      ? summarizeArgs(primaryTool.toolName, primaryTool.args)
      : ''
    const displayText =
      cleanText ||
      log.step.text ||
      (primaryTool
        ? `${primaryTool.toolName ?? '工具'}${primaryToolSummary ? ` ${primaryToolSummary}` : ''}`
        : `处理包含 ${toolCount} 个工具${toolCount !== 1 ? 's' : ''} 的步骤`)

    return (
      <motion.div
        initial={{ opacity: 0.14, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="progress-step-row"
      >
        <div className="progress-step-number">{displayableIndex}</div>
        <div className="progress-step-content">
          <div className="progress-step-top">
            <div className="progress-step-body">
              {displayText}
              {toolCount > 0 && (
                <div className="log-meta">
                  <span className="tool-pill">
                    {toolCount} 个工具{toolCount !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
              {jsonBlocks.length > 0 && (
                <details className="json-snippet-details">
                  <summary className="json-snippet-summary">
                    <span>结构化数据</span>
                    <span className="tool-pill">{jsonBlocks.length} 个 JSON</span>
                  </summary>
                  <div className="json-snippet-group">
                    {jsonBlocks.map((block) => (
                      <pre key={block} className="json-snippet">
                        {formatJson(block)}
                      </pre>
                    ))}
                  </div>
                </details>
              )}
            </div>
            {visibleToolCount > 0 && (
              <button
                type="button"
                onClick={() => toggleStep(index)}
                className="progress-step-toggle"
                aria-label={isExpanded ? 'Collapse tool output' : 'Expand tool output'}
              >
                {isExpanded ? (
                  <Icon icon="lucide:chevron-up" width={16} height={16} />
                ) : (
                  <Icon icon="lucide:chevron-down" width={16} height={16} />
                )}
              </button>
            )}
          </div>
          <AnimatePresence>
            {isExpanded && visibleToolCount > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0.14 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0.14 }}
                transition={{ duration: 0.2 }}
                className="progress-step-tools"
              >
                <div className="progress-step-toolsList">
                  {visibleToolCalls.map((tool, toolIndex) => {
                    const toolKey =
                      tool.toolCallId ??
                      `${toolIndex}:${tool.toolName ?? 'tool'}:${stableSerialize(tool.args)}`
                    const summary = summarizeArgs(tool.toolName, tool.args)
                    const normalizedToolName = tool.toolName
                      ? normalizeToolNameKey(tool.toolName)
                      : ''
                    const isBugCard = normalizedToolName === 'report_bug'
                    const toolResults = log.step?.toolResults ?? []
                    const matchingResults = toolResults.filter((result) => {
                      if (tool.toolCallId && result.toolCallId) {
                        return result.toolCallId === tool.toolCallId
                      }
                      if (tool.toolName && result.toolName) {
                        return result.toolName === tool.toolName
                      }
                      return false
                    })

                    const status =
                      isBugCard &&
                      isRecord(tool.args) &&
                      typeof tool.args.status === 'string'
                        ? String(tool.args.status)
                        : null

                    return (
                      <details
                        key={toolKey}
                        className={`tool-call${isBugCard ? ' tool-call--bug' : ''}`}
                        open={detailsOpenState[toolKey] ?? false}
                        onToggle={handleDetailsToggle(toolKey)}
                      >
                        <summary className="tool-call-summary">
                          <span className="tool-call-summaryLeft">
                            <Icon
                              icon={getToolIcon(tool.toolName)}
                              width={16}
                              height={16}
                            />
                            <span className="tool-call-name">
                              {tool.toolName ?? '工具'}
                            </span>
                          </span>
                          {summary ? (
                            <span className="tool-call-summaryText">{summary}</span>
                          ) : null}
                          {isBugCard && status ? (
                            <span
                              className={`tool-pill ${
                                status.toUpperCase() === 'VERIFIED'
                                  ? 'tool-pill--ok'
                                  : 'tool-pill--warn'
                              }`}
                            >
                              {status.toUpperCase() === 'VERIFIED' ? '已验证' : '未验证'}
                            </span>
                          ) : null}
                          <span className="tool-pill">{isBugCard ? 'Bug' : '调用'}</span>
                        </summary>
                        <div className="tool-call-body">
                          <div className="tool-call-section">
                            <div className="tool-call-sectionHeader">
                              <span>参数</span>
                              <CopyButton text={normalizeText(tool.args)} />
                            </div>
                            <KeyValueTable value={tool.args} />
                          </div>

                          {matchingResults.length > 0 ? (
                            <details
                              className="tool-call-result"
                              open={detailsOpenState[`${toolKey}:result`] ?? false}
                              onToggle={handleDetailsToggle(`${toolKey}:result`)}
                            >
                              <summary className="tool-call-resultSummary">
                                <span>输出</span>
                              </summary>
                              {matchingResults.map((result, resultIndex) => (
                                <div
                                  key={
                                    result.toolCallId ??
                                    `${toolKey}:result:${resultIndex}`
                                  }
                                  className="tool-call-section"
                                >
                                  <div className="tool-call-sectionHeader">
                                    <span>结果</span>
                                    <CopyButton text={normalizeText(result.result)} />
                                  </div>
                                  <KeyValueTable value={result.result} />
                                </div>
                              ))}
                            </details>
                          ) : null}

                          <details className="tool-call-raw">
                            <summary className="tool-call-resultSummary">
                              <span>原始 JSON</span>
                            </summary>
                            <pre className="tool-detail-body">
                              {safeStringify({ call: tool, result: matchingResults })}
                            </pre>
                          </details>
                        </div>
                      </details>
                    )
                  })}
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
        initial={{ opacity: 0.14, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="progress-step-row progress-step-row--error"
      >
        <div className="progress-step-number progress-step-number--error">
          {displayableIndex}
        </div>
        <div className="progress-step-content progress-step-content--error">
          <div className="progress-step-errorRow">
            <Icon
              icon="lucide:x-circle"
              width={16}
              height={16}
              className="progress-step-errorIcon"
            />
            <span>{log.message}</span>
          </div>
        </div>
      </motion.div>
    )
  }

  return null
}
