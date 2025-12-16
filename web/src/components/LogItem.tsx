import { Icon } from '@iconify/react'
import { AnimatePresence, motion } from 'framer-motion'
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

export function LogItem({
  log,
  index,
  displayableIndex,
  isExpanded,
  toggleStep,
}: LogItemProps) {
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
        initial={{ opacity: 0.14, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="progress-step-row"
      >
        <div className="progress-step-number">{displayableIndex}</div>
        <div className="progress-step-content">
          {cleanText || log.message}
          {jsonBlocks.length > 0 && (
            <div className="json-snippet-group">
              {jsonBlocks.map((block) => (
                <pre key={block} className="json-snippet">
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
        initial={{ opacity: 0.14, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="progress-step-row"
      >
        <div className="progress-step-number">{displayableIndex}</div>
        <div className="progress-step-content">发现 {log.files?.length} 个文件待审查</div>
      </motion.div>
    )
  }

  if (log.type === 'step' && log.step) {
    const toolCount = log.step.toolCalls?.length || 0

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

    const toolKeyCounts = new Map<string, number>()
    const getToolKey = (tool: { toolName?: string; args: unknown }) => {
      const base = `${tool.toolName ?? 'tool'}:${stableSerialize(tool.args)}`
      const nextCount = (toolKeyCounts.get(base) ?? 0) + 1
      toolKeyCounts.set(base, nextCount)
      return `${base}#${nextCount}`
    }

    const { cleanText, jsonBlocks } = extractJsonBlocks(log.step.text)
    const displayText =
      cleanText ||
      log.step.text ||
      `处理包含 ${toolCount} 个工具${toolCount !== 1 ? 's' : ''} 的步骤`

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
                <div className="json-snippet-group">
                  {jsonBlocks.map((block) => (
                    <pre key={block} className="json-snippet">
                      {formatJson(block)}
                    </pre>
                  ))}
                </div>
              )}
            </div>
            {toolCount > 0 && (
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
            {isExpanded && log.step.toolCalls && toolCount > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0.14 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0.14 }}
                transition={{ duration: 0.2 }}
                className="progress-step-tools"
              >
                <div className="progress-step-toolsList">
                  {log.step.toolCalls.map((tool) => (
                    <div key={getToolKey(tool)} className="tool-detail-card">
                      <div className="tool-detail-header">
                        <span>{tool.toolName ?? '工具'}</span>
                        <span className="tool-pill">调用</span>
                      </div>
                      <pre className="tool-detail-body">{formatToolArgs(tool.args)}</pre>
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
