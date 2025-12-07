import { motion } from 'framer-motion'
import { Settings, Plus, ArrowUp, BookOpen, Clock3 } from 'lucide-react'
import type { ReviewSession } from '../types'

interface HomeProps {
    modelString: string
    setModelString: (model: string) => void
    startReview: () => void
    setShowConfig: (show: boolean) => void
    setActiveSession: (session: ReviewSession | null) => void
    history: ReviewSession[]
    onOpenHistorySession: (session: ReviewSession) => void
}

export function Home({
    modelString,
    setModelString,
    startReview,
    setShowConfig,
    setActiveSession,
    history,
    onOpenHistorySession
}: HomeProps) {
    const formatDate = (timestamp?: number) => {
        if (!timestamp) return 'Unknown time'
        return new Date(timestamp).toLocaleString()
    }

    return (
        <motion.div
            key="home"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex flex-col items-center justify-center gap-8 w-full max-w-3xl min-h-[60vh] mx-auto"
        >
            <div className="text-center space-y-4">
                <h1 className="hero-title text-6xl md:text-8xl">CoStrict-Code Review</h1>
                <p className="subtitle">今天我可以为您审查什么代码？</p>
            </div>

            <div className="w-full relative">
                {/* Input Bar */}
                <div className="input-group">
                    <button
                        onClick={() => setShowConfig(true)}
                        className="action-btn"
                    >
                        <Settings className="w-5 h-5" />
                    </button>

                    <input
                        type="text"
                        value={modelString}
                        onChange={(e) => setModelString(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && startReview()}
                        className="chat-input"
                        placeholder="输入模型名称 (例如: openai:glm-4-flash)..."
                    />

                    <button
                        onClick={() => {
                            setModelString('')
                            setActiveSession(null)
                        }}
                        className="action-btn"
                        title="清除 / 新建会话"
                    >
                        <Plus className="w-5 h-5" />
                    </button>

                    <button
                        onClick={startReview}
                        disabled={!modelString}
                        className="send-btn"
                    >
                        <ArrowUp className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div className="history-section w-full">
                <div className="history-header">
                    <div className="session-chip">
                        <BookOpen className="w-4 h-4" /> 最近审查
                    </div>
                </div>
                {history.length === 0 ? (
                    <div className="empty-state">
                        <p>暂无保存的历史记录。运行您的第一次审查后，结果将显示在这里。</p>
                    </div>
                ) : (
                    <div className="history-grid">
                        {history.slice(0, 4).map((session) => (
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
                                        ? session.finalResult.slice(0, 200).concat(session.finalResult.length > 200 ? '…' : '')
                                        : 'No summary available.'}
                                </div>
                                <div className="history-footer">
                                    <button className="ghost-btn" onClick={() => onOpenHistorySession(session)}>
                                        查看
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </motion.div>
    )
}
