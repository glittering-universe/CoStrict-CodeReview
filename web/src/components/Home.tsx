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
    lang: 'zh' | 'en' 
}

export function Home({
    modelString,
    setModelString,
    startReview,
    setShowConfig,
    setActiveSession,
    history,
    onOpenHistorySession,
    lang
}: HomeProps) {
    const formatDate = (timestamp?: number) => {
        if (!timestamp) return 'Unknown time'
        return new Date(timestamp).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')
    }

    // 翻译配置
    const t = {
        subtitle: lang === 'zh' ? '今天想审查什么代码？' : 'What can I review for you today?',
        placeholder: lang === 'zh' ? '输入模型名称 (如 glm-4.5-flash)...' : 'Enter model (e.g. glm-4.5-flash)...',
        recent: lang === 'zh' ? '最近的审查' : 'Recent Reviews',
        noHistory: lang === 'zh' ? '暂无历史记录。开始您的第一次审查吧。' : 'No saved history yet. Run your first review to see it here.',
        session: lang === 'zh' ? '会话 #' : 'Session #',
        view: lang === 'zh' ? '查看' : 'View',
        noSummary: lang === 'zh' ? '暂无摘要。' : 'No summary available.',
        clear: lang === 'zh' ? '清除 / 新会话' : 'Clear / New Session'
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
<<<<<<< HEAD
                <h1 className="hero-title text-6xl md:text-8xl">Costrict-CodeReview</h1>
                <p className="subtitle">{t.subtitle}</p>
=======
                <h1 className="hero-title text-6xl md:text-8xl">CoStrict-Code Review</h1>
                <p className="subtitle">今天我可以为您审查什么代码？</p>
>>>>>>> main
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
<<<<<<< HEAD
                        placeholder={t.placeholder}
=======
                        placeholder="输入模型名称 (例如: openai:glm-4-flash)..."
>>>>>>> main
                    />

                    <button
                        onClick={() => {
                            setModelString('')
                            setActiveSession(null)
                        }}
                        className="action-btn"
<<<<<<< HEAD
                        title={t.clear}
=======
                        title="清除 / 新建会话"
>>>>>>> main
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
<<<<<<< HEAD
                        <BookOpen className="w-4 h-4" /> {t.recent}
=======
                        <BookOpen className="w-4 h-4" /> 最近审查
>>>>>>> main
                    </div>
                </div>
                {history.length === 0 ? (
                    <div className="empty-state">
<<<<<<< HEAD
                        <p>{t.noHistory}</p>
=======
                        <p>暂无保存的历史记录。运行您的第一次审查后，结果将显示在这里。</p>
>>>>>>> main
                    </div>
                ) : (
                    <div className="history-grid">
                        {history.slice(0, 4).map((session) => (
                            <div key={session.id} className="history-card">
                                <div className="history-card-header">
                                    <div>
                                        <p className="history-model">{session.modelString}</p>
                                        <p className="history-id">{t.session}{session.id}</p>
                                    </div>
                                    <div className="history-meta">
                                        <Clock3 className="w-4 h-4" />
                                        {formatDate(session.completedAt)}
                                    </div>
                                </div>
                                <div className="history-body">
                                    {session.finalResult
                                        ? session.finalResult.slice(0, 200).concat(session.finalResult.length > 200 ? '…' : '')
                                        : t.noSummary}
                                </div>
                                <div className="history-footer">
                                    <button className="ghost-btn" onClick={() => onOpenHistorySession(session)}>
<<<<<<< HEAD
                                        {t.view}
=======
                                        查看
>>>>>>> main
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