import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { ConfigModal, type ConfigSettings } from './components/ConfigModal'
import { Home } from './components/Home'
import { Layout } from './components/Layout'
import { ReviewSession as ReviewSessionComponent } from './components/ReviewSession'
import type { Log, ReviewSession } from './types'

const DEFAULT_MODEL = 'openai:glm-4.5-flash'
const HISTORY_STORAGE_KEY = 'costrict.review-history'

const cloneSession = (session: ReviewSession): ReviewSession =>
  JSON.parse(JSON.stringify(session)) as ReviewSession

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
    environment: 'local',
  })

  // UI State for collapsible sections
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())
  const [expandAll, setExpandAll] = useState(false)

  const logsEndRef = useRef<HTMLDivElement>(null)

  const toggleStep = (index: number) => {
    setExpandedSteps((prev) => {
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
      const allIndices =
        activeSession?.logs
          .map((_, i) => i)
          .filter((i) => {
            const log = activeSession.logs[i]
            return (
              log.type === 'step' && log.step?.toolCalls && log.step.toolCalls.length > 0
            )
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
      startTime: Date.now(),
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
          environment: config.environment,
        }),
      })

      if (!response.ok) throw new Error('Failed to start review')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader available')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const newLogs: Log[] = []
        while (true) {
          const boundary = buffer.indexOf('\n\n')
          if (boundary === -1) break
          const event = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)

          if (!event.startsWith('data: ')) continue

          try {
            const data = JSON.parse(event.slice(6)) as Omit<Log, 'timestamp'>
            newLogs.push({ ...data, timestamp: Date.now() })
          } catch (parseError) {
            console.error('Failed to parse SSE event', parseError)
          }
        }

        if (newLogs.length === 0) continue

        setActiveSession((prev) => {
          if (!prev) return null
          const updated: ReviewSession = {
            ...prev,
            logs: [...prev.logs, ...newLogs],
          }

          for (const log of newLogs) {
            if (log.type === 'files') {
              updated.files = log.files ?? []
              continue
            }
            if (log.type === 'complete') {
              updated.finalResult = log.result ?? null
              updated.isReviewing = false
              updated.completedAt = log.timestamp
              continue
            }
            if (log.type === 'error') {
              updated.isReviewing = false
              updated.completedAt = log.timestamp
            }
          }

          return updated
        })
      }
    } catch (error) {
      console.error(error)
      setActiveSession((prev) => {
        if (!prev) return null
        return {
          ...prev,
          isReviewing: false,
          completedAt: prev.completedAt ?? Date.now(),
          logs: [
            ...prev.logs,
            {
              type: 'error',
              message: error instanceof Error ? error.message : 'Unknown error',
              timestamp: Date.now(),
            },
          ],
        }
      })
    }
  }

  const scrollToken = `${activeSession?.logs.length ?? 0}:${activeSession?.finalResult ? 1 : 0}`

  useEffect(() => {
    if (scrollToken === '0:0') return
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [scrollToken])

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
    setHistory((prev) => {
      if (prev.some((session) => session.id === activeSession.id)) return prev
      const snapshot = cloneSession({
        ...activeSession,
        completedAt: activeSession.completedAt ?? Date.now(),
      })
      return [snapshot, ...prev].slice(0, 50)
    })
  }, [activeSession])

  return (
    <Layout view={view} setView={setView} activeSession={activeSession}>
      <AnimatePresence mode="sync">
        {view === 'home' ? (
          <motion.div
            key="home"
            className="view-layer"
            initial={{ opacity: 1, filter: 'blur(0px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0.14, filter: 'blur(28px) brightness(0.18) saturate(0.7)' }}
            transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
          >
            <Home
              modelString={modelString}
              setModelString={setModelString}
              startReview={startReview}
              setShowConfig={setShowConfig}
            />
          </motion.div>
        ) : (
          <motion.div
            key="review"
            className="view-layer"
            initial={{ opacity: 1, filter: 'blur(0px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0.14, filter: 'blur(18px) brightness(0.22)' }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            <ReviewSessionComponent
              activeSession={activeSession}
              setView={setView}
              expandedSteps={expandedSteps}
              toggleStep={toggleStep}
              expandAll={expandAll}
              toggleExpandAll={toggleExpandAll}
              logsEndRef={logsEndRef}
            />
          </motion.div>
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
