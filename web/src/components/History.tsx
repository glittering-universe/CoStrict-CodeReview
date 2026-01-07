import { Icon } from '@iconify/react'
import { motion } from 'framer-motion'
import type { ReviewSession } from '../types'

interface HistoryProps {
  history: ReviewSession[]
  openSession: (session: ReviewSession) => void
  activeSession: ReviewSession | null
  runningSession: ReviewSession | null
  openRunningSession: () => void
}

const formatDuration = (startTime: number, endTime?: number) => {
  const ms = Math.max(0, (endTime ?? Date.now()) - startTime)
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  if (minutes < 60) return `${minutes}m ${remaining}s`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return `${hours}h ${remMinutes}m`
}

const resolveStatus = (session: ReviewSession) => {
  if (session.isReviewing) return { label: '运行中', tone: 'running' as const }
  if (session.finalResult) return { label: '已完成', tone: 'done' as const }
  if (session.logs.some((log) => log.type === 'error')) {
    return { label: '失败', tone: 'error' as const }
  }
  return { label: '已结束', tone: 'idle' as const }
}

const countTimelineLogs = (session: ReviewSession) =>
  session.logs.filter(
    (log) =>
      log.type === 'status' ||
      log.type === 'files' ||
      log.type === 'sandbox_request' ||
      log.type === 'step' ||
      log.type === 'error'
  ).length

export function History({
  history,
  openSession,
  activeSession,
  runningSession,
  openRunningSession,
}: HistoryProps) {
  return (
    <div className="history-root">
      <motion.div
        initial={{ opacity: 0.14, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22, mass: 0.8 }}
        className="history-shell"
      >
        <div className="history-header">
          <div>
            <p className="history-title">审查历史</p>
            <p className="history-subtitle">查看并重新打开过往审查结果</p>
          </div>
          <div className="history-headerActions">
            {runningSession?.isReviewing ? (
              <button
                type="button"
                className="history-runningBtn"
                onClick={openRunningSession}
              >
                <Icon icon="lucide:activity" width={16} height={16} />
                审查进行中
              </button>
            ) : null}
            <div className="history-count">
              <Icon icon="lucide:clock-3" width={16} height={16} />
              {history.length}
            </div>
          </div>
        </div>

        {history.length === 0 ? (
          <div className="history-empty">
            <Icon icon="lucide:inbox" width={22} height={22} />
            <div>
              <p className="history-emptyTitle">暂无记录</p>
              <p className="history-emptyHint">完成一次审查后，会自动出现在这里。</p>
            </div>
          </div>
        ) : (
          <div className="history-list">
            {history.map((session) => {
              const status = resolveStatus(session)
              const isActive = activeSession?.id === session.id
              const stepsCount = countTimelineLogs(session)
              const endTime =
                session.completedAt ??
                (session.isReviewing
                  ? undefined
                  : session.logs[session.logs.length - 1]?.timestamp)
              const duration = formatDuration(session.startTime, endTime)
              const startedAt = new Date(session.startTime).toLocaleString()
              const snippet = session.finalResult?.trim() ?? ''

              return (
                <button
                  key={session.id}
                  type="button"
                  className={`history-item${isActive ? ' history-item--active' : ''}`}
                  onClick={() => openSession(session)}
                >
                  <div className="history-itemTop">
                    <div className="history-itemModel">
                      <Icon icon="lucide:sparkles" width={16} height={16} />
                      <span>{session.modelString}</span>
                    </div>
                    <span className={`history-status history-status--${status.tone}`}>
                      {status.label}
                    </span>
                  </div>

                  <div className="history-itemMeta">
                    <span className="history-metaPill">
                      <Icon icon="lucide:calendar" width={14} height={14} />
                      {startedAt}
                    </span>
                    <span className="history-metaPill">
                      <Icon icon="lucide:clock-3" width={14} height={14} />
                      {duration}
                    </span>
                    <span className="history-metaPill">
                      <Icon icon="lucide:file-text" width={14} height={14} />
                      {session.files.length}
                    </span>
                    <span className="history-metaPill">
                      <Icon icon="lucide:list-check" width={14} height={14} />
                      {stepsCount}
                    </span>
                  </div>

                  {snippet ? (
                    <p className="history-itemSnippet">{snippet}</p>
                  ) : (
                    <p className="history-itemSnippet history-itemSnippet--muted">
                      无 summary
                    </p>
                  )}

                  <div className="history-itemAction">
                    <span>打开</span>
                    <Icon icon="lucide:arrow-right" width={16} height={16} />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </motion.div>
    </div>
  )
}
