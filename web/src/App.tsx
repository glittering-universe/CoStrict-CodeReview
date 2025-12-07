import { useState, useEffect, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { Log, ReviewSession } from './types'
import { Layout } from './components/Layout'
import { Home } from './components/Home'
import { ReviewSession as ReviewSessionComponent } from './components/ReviewSession'
import { ConfigModal, type ConfigSettings } from './components/ConfigModal'

const DEFAULT_MODEL = 'openai:glm-4.5-flash'
const HISTORY_STORAGE_KEY = 'costrict.review-history'

const cloneSession = (session: ReviewSession): ReviewSession =>
    JSON.parse(JSON.stringify(session)) as ReviewSession

const API_CONFIG = {
  apiKey: import.meta.env.OPENAI_API_KEY,
  apiBase: import.meta.env.OPENAI_API_BASE,
};

const resolveApiBaseUrl = () => {
    const env = (import.meta.env as Record<string, string | undefined>).VITE_API_BASE_URL
    if (env) {
        return env.replace(/\/$/, '')
    }
    if (import.meta.env.DEV) {
        return 'http://localhost:3000'
    }
    if (typeof window !== 'undefined' && window.location.origin) {
        return window.location.origin
    }
    return 'http://localhost:3000'
}

const API_BASE_URL = resolveApiBaseUrl()

function App() {
    // Session State
    const [activeSession, setActiveSession] = useState<ReviewSession | null>(null)
    const [view, setView] = useState<'home' | 'review'>('home')
    const [history, setHistory] = useState<ReviewSession[]>([])

    // Config State
    const [modelString, setModelString] = useState(DEFAULT_MODEL)
    const [showConfig, setShowConfig] = useState(false)
    const [config, setConfig] = useState<ConfigSettings>({
        apiKey: '',
        baseUrl: '',
        environment: 'local'
    })

    // UI State for collapsible sections
    const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())
    const [expandAll, setExpandAll] = useState(false)

    const logsEndRef = useRef<HTMLDivElement>(null)

    const toggleStep = (index: number) => {
        setExpandedSteps(prev => {
            const newSet = new Set(prev)
            if (newSet.has(index)) {
                newSet.delete(index)
            } else {
                newSet.add(index)
            }
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

        // Create new session
        const newSession: ReviewSession = {
            id: Date.now().toString(),
            modelString,
            logs: [],
            files: [],
            finalResult: null,
            isReviewing: true,
            startTime: Date.now()
        }
        setActiveSession(newSession)
        setView('review')
        setShowConfig(false)

        try {
            const response = await fetch(`${API_BASE_URL}/api/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    modelString,
                    isLocal: config.environment === 'local',
                    apiKey: config.apiKey || undefined,
                    baseUrl: config.baseUrl || undefined,
                    environment: config.environment
                }),
            })

            if (!response.ok) throw new Error('Failed to start review')

            const reader = response.body?.getReader()
            if (!reader) throw new Error('No reader available')

            const decoder = new TextDecoder()

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                const chunk = decoder.decode(value)
                const lines = chunk.split('\n\n')

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = JSON.parse(line.slice(6))
                        const log: Log = { ...data, timestamp: Date.now() }

                        setActiveSession(prev => {
                            if (!prev) return null
                            const updated = { ...prev, logs: [...prev.logs, log] }

                            if (data.type === 'files') {
                                updated.files = data.files
                            } else if (data.type === 'complete') {
                                updated.finalResult = data.result
                                updated.isReviewing = false
                                updated.completedAt = Date.now()
                            } else if (data.type === 'error') {
                                updated.isReviewing = false
                                updated.completedAt = Date.now()
                            }
                            return updated
                        })
                    }
                }
            }
        } catch (error) {
            console.error(error)
            setActiveSession(prev => {
                if (!prev) return null
                return {
                    ...prev,
                    isReviewing: false,
                    completedAt: prev.completedAt ?? Date.now(),
                    logs: [...prev.logs, {
                        type: 'error',
                        message: error instanceof Error ? error.message : 'Unknown error',
                        timestamp: Date.now()
                    }]
                }
            })
        }
    }

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [activeSession?.logs, activeSession?.finalResult])

    useEffect(() => {
        if (typeof window === 'undefined') return
        const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY)
        if (stored) {
            try {
                const parsed = JSON.parse(stored) as ReviewSession[]
                setHistory(parsed)
            } catch (error) {
                console.error('Failed to parse history', error)
            }
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
            const snapshot = cloneSession({
                ...activeSession,
                completedAt: activeSession.completedAt ?? Date.now()
            })
            return [snapshot, ...prev].slice(0, 50)
        })
    }, [activeSession])

    const handleOpenHistorySession = (session: ReviewSession) => {
        setActiveSession(cloneSession(session))
        setView('review')
    }

    return (
        <Layout view={view} setView={setView} activeSession={activeSession}>
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
