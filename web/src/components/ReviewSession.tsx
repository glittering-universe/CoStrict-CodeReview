import { motion } from 'framer-motion'
import {
    ArrowLeft,
    ChevronsUp,
    ChevronsDown,
    Sparkles,
    Activity,
    FileText,
    Clock3,
    CheckCircle2
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { ReviewSession as ReviewSessionType } from '../types'
import type { RefObject } from 'react'
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

export function ReviewSession({
    activeSession,
    setView,
    expandedSteps,
    toggleStep,
    expandAll,
    toggleExpandAll,
    logsEndRef
}: ReviewSessionProps) {
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
        ? 'Running'
        : activeSession?.finalResult
            ? 'Complete'
            : 'Waiting'

    const statusVariant = activeSession?.isReviewing
        ? 'running'
        : activeSession?.finalResult
            ? 'done'
            : 'idle'

    const lastUpdateTimestamp = activeSession
        ? (activeSession.logs[activeSession.logs.length - 1]?.timestamp ?? activeSession.startTime)
        : null

    const elapsedLabel = activeSession && lastUpdateTimestamp
        ? formatDuration(lastUpdateTimestamp - activeSession.startTime)
        : '--'

    const fileCount = activeSession?.files.length ?? 0
    const stepsCount = activeSession?.logs.length ?? 0
    const modelName = activeSession?.modelString ?? 'Not started'

    return (
        <motion.div
            key="review"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            className="w-full max-w-5xl flex flex-col gap-6"
        >
            <div className="review-header">
                <button
                    onClick={() => setView('home')}
                    className="close-btn"
                    aria-label="Back to home"
                >
                    <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="session-chip">
                    <Sparkles className="w-4 h-4" />
                    {modelName}
                </div>
            </div>

            <div className="session-overview">
                <div className="overview-card">
                    <div className="overview-label">
                        <Activity className="w-4 h-4" /> Status
                    </div>
                    <div className={`status-pill ${statusVariant}`}>
                        {statusVariant === 'done' ? <CheckCircle2 className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                        {statusLabel}
                    </div>
                </div>
                <div className="overview-card">
                    <div className="overview-label">
                        <Clock3 className="w-4 h-4" /> Elapsed
                    </div>
                    <div className="overview-value">{elapsedLabel}</div>
                </div>
                <div className="overview-card">
                    <div className="overview-label">
                        <FileText className="w-4 h-4" /> Files
                    </div>
                    <div className="overview-value">{fileCount}</div>
                </div>
                <div className="overview-card">
                    <div className="overview-label">
                        <Sparkles className="w-4 h-4" /> Steps
                    </div>
                    <div className="overview-value">{stepsCount}</div>
                </div>
            </div>

            <div className="timeline-card">
                <div className="timeline-card-header">
                    <div>
                        <p className="timeline-title">Progress Updates</p>
                        <p className="timeline-subtitle">Live agent status and tool activity</p>
                    </div>
                    <button
                        onClick={toggleExpandAll}
                        className="ghost-btn"
                    >
                        {expandAll ? (
                            <>
                                <ChevronsUp className="w-4 h-4" />
                                Collapse all
                            </>
                        ) : (
                            <>
                                <ChevronsDown className="w-4 h-4" />
                                Expand all
                            </>
                        )}
                    </button>
                </div>

                <div className="timeline-list">
                    {activeSession?.logs.map((log, i) => {
                        // Calculate step number (only for displayable items)
                        const displayableIndex = activeSession.logs
                            .slice(0, i + 1)
                            .filter(l => l.type === 'status' || l.type === 'files' || l.type === 'step' || l.type === 'error')
                            .length

                        const isExpanded = expandedSteps.has(i) || expandAll

                        return (
                            <LogItem
                                key={log.timestamp + i}
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
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{
                        type: "spring",
                        stiffness: 260,
                        damping: 25
                    }}
                    className="final-report-card markdown prose prose-invert max-w-none"
                >
                    <div className="final-report-header">
                        <Sparkles className="w-4 h-4" />
                        Review Complete
                    </div>
                    <ReactMarkdown>{activeSession.finalResult}</ReactMarkdown>
                </motion.div>
            )}

            <div ref={logsEndRef} />
        </motion.div>
    )
}

