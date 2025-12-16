import { Icon } from '@iconify/react'
import { motion } from 'framer-motion'
import { useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import ReactMarkdown from 'react-markdown'
import type { ReviewSession as ReviewSessionType } from '../types'
import { EnergyArcCanvas } from '../visual/EnergyArcCanvas'
import { LogItem } from './LogItem'

interface ReviewSessionProps {
  activeSession: ReviewSessionType | null
  setView: (view: 'home' | 'review') => void
  expandedSteps: Set<number>
  toggleStep: (index: number) => void
  expandAll: boolean
  toggleExpandAll: () => void
  logsEndRef: RefObject<HTMLDivElement | null>
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function ReviewSession({
  activeSession,
  setView,
  expandedSteps,
  toggleStep,
  expandAll,
  toggleExpandAll,
  logsEndRef,
}: ReviewSessionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const mouseRef = useRef({ x: 0.52, y: 0.54 })

  const initialQuality = useMemo<1 | 0.75 | 0.5>(() => {
    const isCoarsePointer =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    return isCoarsePointer ? 0.75 : 1
  }, [])

  const renderQuality = initialQuality

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return

    mouseRef.current = {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    }
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

  const lastUpdateTimestamp = activeSession
    ? (activeSession.logs[activeSession.logs.length - 1]?.timestamp ??
      activeSession.startTime)
    : null

  const elapsedLabel =
    activeSession && lastUpdateTimestamp
      ? formatDuration(lastUpdateTimestamp - activeSession.startTime)
      : '--'

  const fileCount = activeSession?.files.length ?? 0
  const stepsCount = activeSession?.logs.length ?? 0
  const modelName = activeSession?.modelString ?? '未开始'

  return (
    <div ref={rootRef} className="review-root" onPointerMove={onPointerMove}>
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
            {activeSession?.logs.map((log, i) => {
              const displayableIndex = activeSession.logs
                .slice(0, i + 1)
                .filter(
                  (l) =>
                    l.type === 'status' ||
                    l.type === 'files' ||
                    l.type === 'step' ||
                    l.type === 'error'
                ).length

              const isExpanded = expandedSteps.has(i) || expandAll

              return (
                <LogItem
                  key={log.timestamp}
                  log={log}
                  index={i}
                  displayableIndex={displayableIndex}
                  isExpanded={isExpanded}
                  toggleStep={toggleStep}
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
