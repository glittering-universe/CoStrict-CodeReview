import { motion } from 'framer-motion'
import { ArrowLeft, BookOpen, Clock3, Sparkles } from 'lucide-react'
import type { ReviewSession } from '../types'

interface HistoryProps {
  sessions: ReviewSession[]
  onBack: () => void
  onOpenSession: (session: ReviewSession) => void
}

const formatDate = (timestamp?: number) => {
  if (!timestamp) return '未知时间'
  return new Date(timestamp).toLocaleString()
}

export function History({ sessions, onBack, onOpenSession }: HistoryProps) {
  return (
    <motion.div
      key="history"
      initial={{ opacity: 0.14, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0.14, x: -30 }}
      transition={{ type: 'spring', stiffness: 280, damping: 28 }}
      className="w-full max-w-5xl flex flex-col gap-6"
    >
      <div className="review-header">
        <button type="button" onClick={onBack} className="ghost-btn">
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>
        <div className="session-chip">
          <BookOpen className="w-4 h-4" />
          审查历史
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <Sparkles className="w-6 h-6" />
          <p>暂无审查记录。开始第一次审查以构建历史记录。</p>
        </div>
      ) : (
        <div className="history-grid">
          {sessions.map((session) => (
            <div key={session.id} className="history-card">
              <div className="history-card-header">
                <div>
                  <p className="history-model">{session.modelString}</p>
                  <p className="history-id">Session #{session.id}</p>
                </div>
                <div className="history-meta">
                  <Clock3 className="w-4 h-4" />
                  {formatDate(session.completedAt)}
                </div>
              </div>
              <div className="history-body">
                {session.finalResult
                  ? session.finalResult
                      .slice(0, 220)
                      .concat(session.finalResult.length > 220 ? '…' : '')
                  : '无可用摘要。'}
              </div>
              <div className="history-footer">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => onOpenSession(session)}
                >
                  查看详情
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}
