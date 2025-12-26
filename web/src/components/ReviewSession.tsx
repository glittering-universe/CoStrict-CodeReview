import { Icon } from '@iconify/react'
import { motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import ReactMarkdown from 'react-markdown'
import type { ReviewSession as ReviewSessionType } from '../types'
import { EnergyArcCanvas } from '../visual/EnergyArcCanvas'
import { LogItem } from './LogItem'

interface ReviewSessionProps {
  activeSession: ReviewSessionType | null
  setView: (view: 'home' | 'review' | 'history') => void
  expandedSteps: Set<number>
  toggleStep: (index: number) => void
  expandAll: boolean
  toggleExpandAll: () => void
  logsEndRef: RefObject<HTMLDivElement | null>
  autoApproveSandbox: boolean
  setAutoApproveSandbox: (value: boolean) => void
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

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

export function ReviewSession({
  activeSession,
  setView,
  expandedSteps,
  toggleStep,
  expandAll,
  toggleExpandAll,
  logsEndRef,
  autoApproveSandbox,
  setAutoApproveSandbox,
}: ReviewSessionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const mouseRef = useRef({ x: 0.52, y: 0.54 })
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [shouldFollow, setShouldFollow] = useState(true)
  const sessionId = activeSession?.id
  const timelineEntries = useMemo(() => {
    const logs = activeSession?.logs ?? []
    const sandboxRequestToolCallIds = new Set(
      logs
        .filter(
          (log) => log.type === 'sandbox_request' && typeof log.toolCallId === 'string'
        )
        .map((log) => log.toolCallId as string)
    )

    return logs
      .map((log, index) => ({ log, index }))
      .filter(({ log }) => {
        if (
          log.type === 'status' ||
          log.type === 'files' ||
          log.type === 'sandbox_request' ||
          log.type === 'error'
        ) {
          return true
        }

        if (log.type !== 'step' || !log.step) return false
        const toolCalls = log.step.toolCalls ?? []
        if (toolCalls.length === 0) return true

        const normalizedToolNames = toolCalls.map((call) =>
          normalizeToolNameKey(call.toolName ?? '')
        )
        const hasNonSandboxTool = normalizedToolNames.some(
          (name) => name && name !== 'sandbox_exec'
        )
        if (hasNonSandboxTool) return true

        const hasUnlinkedSandboxCall = toolCalls.some((call) => {
          const toolCallId = call.toolCallId
          if (typeof toolCallId !== 'string' || !toolCallId.trim()) return true
          return !sandboxRequestToolCallIds.has(toolCallId)
        })

        return hasUnlinkedSandboxCall
      })
  }, [activeSession?.logs])

  const initialQuality = useMemo<1 | 0.75 | 0.5>(() => {
    const isCoarsePointer =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    return isCoarsePointer ? 0.75 : 1
  }, [])

  const renderQuality = initialQuality

  const isNearBottom = () => {
    const root = rootRef.current
    if (!root) return true
    const threshold = 96
    return root.scrollHeight - root.scrollTop - root.clientHeight <= threshold
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return

    mouseRef.current = {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    }
  }

  const onScroll = () => {
    setShouldFollow(isNearBottom())
  }

  const formatDuration = (ms: number) => {
    const seconds = Math.max(0, Math.floor(ms / 1000))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remaining = seconds % 60
    if (minutes < 60) return `${minutes}m ${remaining}s`
    const hours = Math.floor(minutes / 60)
    const remMinutes = minutes % 60
    return `${hours}h ${remMinutes}m`
  }

  const statusLabel = activeSession?.isReviewing
    ? '运行中'
    : activeSession?.finalResult
      ? '已完成'
      : '等待中'

  const statusVariant = activeSession?.isReviewing
    ? 'running'
    : activeSession?.finalResult
      ? 'done'
      : 'idle'

  useEffect(() => {
    if (!activeSession?.isReviewing) return
    setNowMs(Date.now())
    const interval = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [activeSession?.isReviewing])

  useEffect(() => {
    if (!sessionId) return
    setShouldFollow(true)
    logsEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [logsEndRef, sessionId])

  const scrollToken = `${activeSession?.logs.length ?? 0}:${activeSession?.finalResult ? 1 : 0}`

  useEffect(() => {
    if (!activeSession) return
    if (!shouldFollow) return
    if (scrollToken === '0:0') return
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeSession, logsEndRef, scrollToken, shouldFollow])

  const elapsedLabel = activeSession
    ? formatDuration(
        (activeSession.isReviewing
          ? nowMs
          : (activeSession.completedAt ??
            activeSession.logs[activeSession.logs.length - 1]?.timestamp ??
            nowMs)) - activeSession.startTime
      )
    : '--'

  const fileCount = activeSession?.files.length ?? 0
  const stepsCount = timelineEntries.length
  const modelName = activeSession?.modelString ?? '未开始'

  return (
    <div
      ref={rootRef}
      className="review-root"
      onPointerMove={onPointerMove}
      onScroll={onScroll}
    >
      <EnergyArcCanvas
        className="review-canvas"
        mouse={mouseRef}
        renderQuality={renderQuality}
      />

      <motion.div
        key="review"
        initial={{ opacity: 0.14, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0.14, x: -30 }}
        transition={{ type: 'spring', stiffness: 280, damping: 28 }}
        className="review-shell"
      >
        <div className="review-header">
          <button
            type="button"
            onClick={() => setView('home')}
            className="close-btn"
            aria-label="Back to home"
          >
            <Icon icon="lucide:arrow-left" width={16} height={16} />
          </button>
          <div className="session-chip">
            <Icon icon="lucide:sparkles" width={16} height={16} />
            {modelName}
          </div>
        </div>

        <div className="session-overview">
          <div className="overview-card">
            <div className="overview-label">
              <Icon icon="lucide:activity" width={16} height={16} /> 状态
            </div>
            <div className={`status-pill ${statusVariant}`}>
              {statusVariant === 'done' ? (
                <Icon icon="lucide:check-circle-2" width={16} height={16} />
              ) : (
                <Icon icon="lucide:sparkles" width={16} height={16} />
              )}
              {statusLabel}
            </div>
          </div>
          <div className="overview-card">
            <div className="overview-label">
              <Icon icon="lucide:clock-3" width={16} height={16} /> 已用时间
            </div>
            <div className="overview-value">{elapsedLabel}</div>
          </div>
          <div className="overview-card">
            <div className="overview-label">
              <Icon icon="lucide:file-text" width={16} height={16} /> 文件
            </div>
            <div className="overview-value">{fileCount}</div>
          </div>
          <div className="overview-card">
            <div className="overview-label">
              <Icon icon="lucide:sparkles" width={16} height={16} /> 步骤
            </div>
            <div className="overview-value">{stepsCount}</div>
          </div>
          <div className="overview-card overview-card--toggle">
            <div className="overview-label">
              <Icon icon="lucide:shield-check" width={16} height={16} /> 沙盒自动批准
            </div>
            <label className="toggle-switch">
              <span className="sr-only">Toggle sandbox auto approval</span>
              <input
                type="checkbox"
                checked={autoApproveSandbox}
                onChange={(event) => setAutoApproveSandbox(event.target.checked)}
              />
              <span className="toggle-track" aria-hidden />
              <span className="toggle-thumb" aria-hidden />
            </label>
          </div>
        </div>

        <div className="timeline-card">
          <div className="timeline-card-header">
            <div>
              <p className="timeline-title">进度更新</p>
              <p className="timeline-subtitle">实时代理状态和工具活动</p>
            </div>
            <button type="button" onClick={toggleExpandAll} className="ghost-btn">
              {expandAll ? (
                <>
                  <Icon icon="lucide:chevrons-up" width={16} height={16} />
                  全部折叠
                </>
              ) : (
                <>
                  <Icon icon="lucide:chevrons-down" width={16} height={16} />
                  全部展开
                </>
              )}
            </button>
          </div>

          <div className="timeline-list">
            {timelineEntries.map(({ log, index }, visibleIndex) => {
              const isBugStep =
                log.type === 'step' &&
                (log.step?.toolCalls ?? []).some(
                  (call) => normalizeToolNameKey(call.toolName ?? '') === 'report_bug'
                )

              const isExpanded = expandedSteps.has(index) || expandAll || isBugStep

              return (
                <LogItem
                  key={`${log.timestamp}:${index}`}
                  log={log}
                  index={index}
                  displayableIndex={visibleIndex + 1}
                  isExpanded={isExpanded}
                  toggleStep={toggleStep}
                  allLogs={activeSession?.logs ?? []}
                />
              )
            })}
          </div>
        </div>

        {activeSession?.finalResult && (
          <motion.div
            initial={{ opacity: 0.14, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              type: 'spring',
              stiffness: 260,
              damping: 25,
            }}
            className="final-report-card markdown"
          >
            <div className="final-report-header">
              <Icon icon="lucide:sparkles" width={16} height={16} />
              审查完成
            </div>
            <ReactMarkdown>{activeSession.finalResult}</ReactMarkdown>
          </motion.div>
        )}

        <div ref={logsEndRef} />
      </motion.div>
    </div>
  )
}
