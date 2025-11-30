import { motion } from 'framer-motion'
import { ArrowLeft, Clock3, BookOpen, Sparkles } from 'lucide-react'
import type { ReviewSession } from '../types'

interface HistoryProps {
    sessions: ReviewSession[]
    onBack: () => void
    onOpenSession: (session: ReviewSession) => void
}

const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Unknown time'
    return new Date(timestamp).toLocaleString()
}

export function History({ sessions, onBack, onOpenSession }: HistoryProps) {
    return (
        <motion.div
            key="history"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            className="w-full max-w-5xl flex flex-col gap-6"
        >
            <div className="review-header">
                <button onClick={onBack} className="ghost-btn">
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </button>
                <div className="session-chip">
                    <BookOpen className="w-4 h-4" />
                    Review History
                </div>
            </div>

            {sessions.length === 0 ? (
                <div className="empty-state">
                    <Sparkles className="w-6 h-6" />
                    <p>No reviews yet. Start one to build your history.</p>
                </div>
            ) : (
                <div className="history-grid">
                    {sessions.map(session => (
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
                                {session.finalResult ? session.finalResult.slice(0, 220).concat(session.finalResult.length > 220 ? '…' : '') : 'No summary available.'}
                            </div>
                            <div className="history-footer">
                                <button className="ghost-btn" onClick={() => onOpenSession(session)}>
                                    View Details
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </motion.div>
    )
}
