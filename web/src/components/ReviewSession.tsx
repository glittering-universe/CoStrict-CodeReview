import { motion } from 'framer-motion'
import {
    ArrowLeft,
    ChevronsUp,
    ChevronsDown,
    Sparkles,
    Activity,
    FileText,
    Clock3,
    CheckCircle2,
    Download
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { ReviewSession as ReviewSessionType } from '../types'
import { type RefObject, useState, useEffect } from 'react'
import { LogItem } from './LogItem'

interface ReviewSessionProps {
    activeSession: ReviewSessionType | null
    setView: (view: 'home' | 'review') => void
    expandedSteps: Set<number>
    toggleStep: (index: number) => void
    expandAll: boolean
    toggleExpandAll: () => void
    logsEndRef: RefObject<HTMLDivElement | null>
    lang: 'en' | 'zh' 
}

export function ReviewSession({
    activeSession,
    setView,
    expandedSteps,
    toggleStep,
    expandAll,
    toggleExpandAll,
    logsEndRef,
    lang
}: ReviewSessionProps) {
    const [now, setNow] = useState(Date.now())
    useEffect(() => {
        // 只有在审查进行中时才启动计时器
        if (activeSession?.isReviewing) {
            const timer = setInterval(() => setNow(Date.now()), 1000)
            return () => clearInterval(timer)
        }
    }, [activeSession?.isReviewing])
    const formatDuration = (ms: number) => {
        const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
        const minutes = Math.floor(totalSeconds / 60)
        const seconds = totalSeconds % 60
        const pad = (n: number) => n.toString().padStart(2, '0')
        if (lang === 'zh') {
            return `${pad(minutes)}分钟${pad(seconds)}秒`
        }
        return `${pad(minutes)} min ${pad(seconds)} s`
    }

    // 翻译配置
    const t = {
        status: lang === 'zh' ? '状态' : 'Status',
        elapsed: lang === 'zh' ? '耗时' : 'Elapsed',
        files: lang === 'zh' ? '文件数' : 'Files',
        steps: lang === 'zh' ? '步骤' : 'Steps',
        running: lang === 'zh' ? '运行中' : 'Running',
        complete: lang === 'zh' ? '完成' : 'Complete',
        waiting: lang === 'zh' ? '等待中' : 'Waiting',
        progressTitle: lang === 'zh' ? '进度更新' : 'Progress Updates',
        progressSub: lang === 'zh' ? '实时 Agent 状态与工具调用' : 'Live agent status and tool activity',
        collapseAll: lang === 'zh' ? '折叠全部' : 'Collapse all',
        expandAll: lang === 'zh' ? '展开全部' : 'Expand all',
        reviewComplete: lang === 'zh' ? '审查完成' : 'Review Complete',
        notStarted: lang === 'zh' ? '未开始' : 'Not started'
    }

    const statusLabel = activeSession?.isReviewing
<<<<<<< HEAD
        ? t.running
        : activeSession?.finalResult
            ? t.complete
            : t.waiting
=======
        ? '运行中'
        : activeSession?.finalResult
            ? '已完成'
            : '等待中'
>>>>>>> main

    const statusVariant = activeSession?.isReviewing
        ? 'running'
        : activeSession?.finalResult
            ? 'done'
            : 'idle'

    const apiKey = import.meta.env.OPENAI_API_KEY;
    const apiBase = import.meta.env.OPENAI_API_BASE;

    const performCodeReview = async (code: string, language: string) => {
    try {
        const response = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'glm-4', // 或其他模型名称
            messages: [
            {
                role: 'system',
                content: '你是一个专业的代码审查助手，请对提供的代码进行分析和审查。'
            },
            {
                role: 'user',
                content: `请审查以下${language}代码：\n\n${code}`
            }
            ],
            temperature: 0.3,
        }),
        });

        if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('代码审查请求失败:', error);
        throw error;
    }
    };

    // 在组件中使用
    const handleReview = async () => {
    try {
        const reviewResult = await performCodeReview(currentCode, currentLanguage);
        setReviewResults(reviewResult);
    } catch (error) {
        setError('代码审查失败，请检查API配置');
    }
    };
    const lastUpdateTimestamp = activeSession
        ? (activeSession.logs[activeSession.logs.length - 1]?.timestamp ?? activeSession.startTime)
        : null

    const elapsedLabel = (() => {
        if (!activeSession) return '--'
        
        const endTime = activeSession.isReviewing 
            ? now 
            : (activeSession.completedAt ?? activeSession.logs[activeSession.logs.length - 1]?.timestamp ?? activeSession.startTime)
            
        return formatDuration(endTime - activeSession.startTime)
    })()

    const fileCount = activeSession?.files.length ?? 0
    const stepsCount = activeSession?.logs.length ?? 0
<<<<<<< HEAD
    const modelName = activeSession?.modelString ?? t.notStarted

// [新增] 下载 Markdown 的逻辑
    const handleDownload = () => {
        if (!activeSession?.finalResult) return;

        // 1. 生成文件名 CodeReview_YYYYMMDD-HHMMSS.md
        const date = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const timestamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
        const fileName = `CodeReview_${timestamp}.md`;

        // 2. 创建 Blob 并触发下载
        const blob = new Blob([activeSession.finalResult], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        
        // 3. 清理资源
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    const tDownload = lang === 'zh' ? '下载报告' : 'Download Report';
=======
    const modelName = activeSession?.modelString ?? '未开始'
>>>>>>> main

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
<<<<<<< HEAD
                        <Activity className="w-4 h-4" /> {t.status}
=======
                        <Activity className="w-4 h-4" /> 状态
>>>>>>> main
                    </div>
                    <div className={`status-pill ${statusVariant}`}>
                        {statusVariant === 'done' ? <CheckCircle2 className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                        {statusLabel}
                    </div>
                </div>
                <div className="overview-card">
                    <div className="overview-label">
<<<<<<< HEAD
                        <Clock3 className="w-4 h-4" /> {t.elapsed}
=======
                        <Clock3 className="w-4 h-4" /> 已用时间
>>>>>>> main
                    </div>
                    <div className="overview-value">{elapsedLabel}</div>
                </div>
                <div className="overview-card">
                    <div className="overview-label">
<<<<<<< HEAD
                        <FileText className="w-4 h-4" /> {t.files}
=======
                        <FileText className="w-4 h-4" /> 文件
>>>>>>> main
                    </div>
                    <div className="overview-value">{fileCount}</div>
                </div>
                <div className="overview-card">
                    <div className="overview-label">
<<<<<<< HEAD
                        <Sparkles className="w-4 h-4" /> {t.steps}
=======
                        <Sparkles className="w-4 h-4" /> 步骤
>>>>>>> main
                    </div>
                    <div className="overview-value">{stepsCount}</div>
                </div>
            </div>

            <div className="timeline-card">
                <div className="timeline-card-header">
                    <div>
<<<<<<< HEAD
                        <p className="timeline-title">{t.progressTitle}</p>
                        <p className="timeline-subtitle">{t.progressSub}</p>
=======
                        <p className="timeline-title">进度更新</p>
                        <p className="timeline-subtitle">实时代理状态和工具活动</p>
>>>>>>> main
                    </div>
                    <button
                        onClick={toggleExpandAll}
                        className="ghost-btn"
                    >
                        {expandAll ? (
                            <>
                                <ChevronsUp className="w-4 h-4" />
<<<<<<< HEAD
                                {t.collapseAll}
=======
                                全部折叠
>>>>>>> main
                            </>
                        ) : (
                            <>
                                <ChevronsDown className="w-4 h-4" />
<<<<<<< HEAD
                                {t.expandAll}
=======
                                全部展开
>>>>>>> main
                            </>
                        )}
                    </button>
                </div>

                <div className="timeline-list">
                    {activeSession?.logs.map((log, i) => {
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
                                lang={lang}
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
<<<<<<< HEAD
                    <div className="final-report-header flex justify-between items-center w-full">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4" />
                            {t.reviewComplete}
                        </div>
                        
                        <button 
                            onClick={handleDownload}
                            className="flex items-center gap-2 text-xs bg-[var(--accent)] text-[var(--btn-text-hover)] px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity font-bold cursor-pointer border-none"
                            title={tDownload}
                        >
                            <Download className="w-3 h-3" />
                            MD
                        </button>
=======
                    <div className="final-report-header">
                        <Sparkles className="w-4 h-4" />
                        审查完成
>>>>>>> main
                    </div>
                    <ReactMarkdown>{activeSession.finalResult}</ReactMarkdown>
                </motion.div>
            )}

            <div ref={logsEndRef} />
        </motion.div>
    )
}