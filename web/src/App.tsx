import { useState, useEffect, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { Log, ReviewSession } from './types'
import { Layout } from './components/Layout'
import { Home } from './components/Home'
import { ReviewSession as ReviewSessionComponent } from './components/ReviewSession'
import { ConfigModal, type ConfigSettings } from './components/ConfigModal'

// 修改：设置默认模型
const DEFAULT_MODEL = 'openai:glm-4.5-flash'
const HISTORY_STORAGE_KEY = 'costrict-code-review.review-history'

const cloneSession = (session: ReviewSession): ReviewSession =>
    JSON.parse(JSON.stringify(session)) as ReviewSession

const resolveApiBaseUrl = () => {
    const env = (import.meta.env as Record<string, string | undefined>).VITE_API_BASE_URL
    if (env) {
        return env.replace(/\/$/, '')
    }
    
    if (import.meta.env.DEV) {
        return '' 
    }
    
    if (typeof window !== 'undefined' && window.location.origin) {
        return window.location.origin
    }
    return 'http://localhost:3000'
}

const API_BASE_URL = resolveApiBaseUrl()
const CONFIG_STORAGE_KEY = 'costrict-code-review.config';

function App() {
    // Session State
    const [activeSession, setActiveSession] = useState<ReviewSession | null>(null)
    const [view, setView] = useState<'home' | 'review'>('home')
    const [history, setHistory] = useState<ReviewSession[]>([])

    // Config State
    const [modelString, setModelString] = useState(DEFAULT_MODEL)
    const [showConfig, setShowConfig] = useState(false)
    
    const [config, setConfig] = useState<ConfigSettings>(() => {
            if (typeof window !== 'undefined') {
                const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
                if (saved) {
                    try {
                        return JSON.parse(saved);
                    } catch (e) {
                        console.error('Failed to parse config', e);
                    }
                }
            }
            // 默认值
            return {
                apiKey: '679ceed7766b477cb6f540630ef1e0ac.JyW7I8wtqiLRSxGx',
                baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
                environment: 'local',
                language: 'zh',
                theme: 'dark'
            };
        });

    useEffect(() => {
            localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
            document.documentElement.setAttribute('data-theme', config.theme);
        }, [config]);


    const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())
    const [expandAll, setExpandAll] = useState(false)
    const logsEndRef = useRef<HTMLDivElement>(null)

    const toggleStep = (index: number) => {
        setExpandedSteps(prev => {
            const newSet = new Set(prev)
            if (newSet.has(index)) newSet.delete(index)
            else newSet.add(index)
            return newSet
        })
    }
    
    const toggleExpandAll = () => {
        if (expandAll) {
            setExpandedSteps(new Set())
        } else {
            const allIndices = activeSession?.logs.map((_, i) => i).filter((i) => {
                const log = activeSession.logs[i]
                return log.type === 'step' && log.step?.toolCalls && log.step.toolCalls.length > 0
            }) || []
            setExpandedSteps(new Set(allIndices))
        }
        setExpandAll(!expandAll)
    }

    const startReview = async () => {
            if (!modelString) return

            // 1. 初始化状态
            const newSession: ReviewSession = {
                id: Date.now().toString(),
                modelString,
                logs: [],
                files: [],
                finalResult: '', // 确保这里是空字符串，不是 null
                isReviewing: true,
                startTime: Date.now()
            }
            setActiveSession(newSession)
            setView('review')
            setShowConfig(false)

            try {
                // 2. 发起请求
                const response = await fetch(`${API_BASE_URL}/api/review`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        modelString,
                        isLocal: config.environment === 'local',
                        apiKey: config.apiKey || undefined,
                        baseUrl: config.baseUrl || undefined,
                        environment: config.environment,
                        language: config.language
                    }),
                })

                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`)
                if (!response.body) throw new Error('No response body')

                // 3. 准备流式读取
                const reader = response.body.getReader()
                const decoder = new TextDecoder()
                let buffer = '' 

                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    
                    // 解码并拼接到缓冲区
                    const chunk = decoder.decode(value, { stream: true })
                    buffer += chunk
                    
                    // 按换行符分割
                    const lines = buffer.split('\n')
                    // 保留最后一行（可能不完整）
                    buffer = lines.pop() || ''

                    for (const line of lines) {
                        const trimmedLine = line.trim()
                        if (!trimmedLine) continue

                        if (trimmedLine.startsWith('0:')) {
                            try {
                                // 去掉前缀 "0:"，解析后面的 JSON 字符串
                                const textContent = JSON.parse(trimmedLine.slice(2))
                                
                                // 更新 React 状态
                                setActiveSession(prev => {
                                    if (!prev) return null
                                    return {
                                        ...prev,
                                        // ⚡️ 关键：实时拼接文本
                                        finalResult: (prev.finalResult || '') + textContent
                                    }
                                })
                            } catch (e) {
                                console.error('解析文本流失败:', e, trimmedLine)
                            }
                        } 
                        // ----------------------------------------------------
                        // 兼容旧格式：data: {...}
                        // ----------------------------------------------------
                        else if (trimmedLine.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(trimmedLine.slice(6))
                                // 处理日志、文件列表等非文本数据
                                if (data.type !== 'complete') { // 忽略 complete，防止覆盖 finalResult
                                    const log: Log = { ...data, timestamp: Date.now() }
                                    setActiveSession(prev => {
                                        if (!prev) return null
                                        const updated = { ...prev, logs: [...prev.logs, log] }
                                        if (data.type === 'files') updated.files = data.files
                                        return updated
                                    })
                                }
                            } catch (e) {
                                // 忽略解析错误
                            }
                        }
                    }
                }

            } catch (error) {
                console.error('Review Error:', error)
                setActiveSession(prev => {
                    if (!prev) return null
                    return {
                        ...prev,
                        logs: [...prev.logs, {
                            type: 'error',
                            message: error instanceof Error ? error.message : 'Unknown error',
                            timestamp: Date.now()
                        }]
                    }
                })
            } finally {
                // 4. 无论成功失败，最后都结束加载状态
                setActiveSession(prev => {
                    if (!prev) return null
                    return { ...prev, isReviewing: false, completedAt: Date.now() }
                })
            }
        }

    // ... (Effect hooks 保持不变) ...
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [activeSession?.logs, activeSession?.finalResult])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY)
        if (stored) {
            try {
                setHistory(JSON.parse(stored))
            } catch (error) { console.error(error) }
        }
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') return
        window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 50)))
    }, [history])

    useEffect(() => {
        if (!activeSession || activeSession.isReviewing) return
        setHistory(prev => {
            if (prev.some(session => session.id === activeSession.id)) return prev
            const snapshot = cloneSession({ ...activeSession, completedAt: activeSession.completedAt ?? Date.now() })
            return [snapshot, ...prev].slice(0, 50)
        })
    }, [activeSession])
    
    const handleOpenHistorySession = (session: ReviewSession) => {
        setActiveSession(cloneSession(session))
        setView('review')
    }

    return (
        <Layout 
            view={view} 
            setView={setView} 
            activeSession={activeSession}
            lang={config.language} 
        >
            <AnimatePresence mode="wait">
                {view === 'home' ? (
                    <Home
                        modelString={modelString}
                        setModelString={setModelString}
                        startReview={startReview}
                        setShowConfig={setShowConfig}
                        setActiveSession={setActiveSession}
                        history={history}
                        onOpenHistorySession={handleOpenHistorySession}
                        lang={config.language}
                    />
                ) : (
                    <ReviewSessionComponent
                        activeSession={activeSession}
                        setView={setView}
                        expandedSteps={expandedSteps}
                        toggleStep={toggleStep}
                        expandAll={expandAll}
                        toggleExpandAll={toggleExpandAll}
                        logsEndRef={logsEndRef}
                        lang={config.language}
                    />
                )}
            </AnimatePresence>

            <ConfigModal
                isOpen={showConfig}
                onClose={() => setShowConfig(false)}
                config={config}
                onSave={setConfig}
            />
        </Layout>
    )
}

export default App