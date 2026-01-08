import { Icon } from '@iconify/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ConfigModal, type ConfigSettings } from './components/ConfigModal'
import { History } from './components/History'
import { Home } from './components/Home'
import { Layout } from './components/Layout'
import { ReviewSession as ReviewSessionComponent } from './components/ReviewSession'
import type { Log, ReviewSession, SandboxRequest } from './types'

const DEFAULT_MODEL = 'openai:GLM-4-Flash'
const HISTORY_STORAGE_KEY = 'costrict.review-history'
const AUTO_APPROVE_STORAGE_KEY = 'costrict.sandbox-auto-approve'
const CONFIG_STORAGE_KEY = 'costrict.api-config'
const MODEL_STORAGE_KEY = 'costrict.model-string'

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
  const [sessionsById, setSessionsById] = useState<Record<string, ReviewSession>>({})
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [view, setView] = useState<'home' | 'review' | 'history'>('home')
  const [history, setHistory] = useState<ReviewSession[]>([])
  const [autoApproveSandbox, setAutoApproveSandbox] = useState(false)
  const autoApproveSandboxRef = useRef(autoApproveSandbox)
  const activeSessionIdRef = useRef<string | null>(activeSessionId)

  // Config State
  const [modelString, setModelString] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_MODEL
    const stored = window.localStorage.getItem(MODEL_STORAGE_KEY)
    return stored?.trim() ? stored : DEFAULT_MODEL
  })
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState<ConfigSettings>(() => {
    const defaults: ConfigSettings = {
      apiKey: '',
      baseUrl: '',
      environment: 'local',
      localRepoPath: '',
    }
    if (typeof window === 'undefined') return defaults
    const stored = window.localStorage.getItem(CONFIG_STORAGE_KEY)
    if (!stored) return defaults
    try {
      const parsed = JSON.parse(stored) as Partial<ConfigSettings>
      return {
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : defaults.apiKey,
        baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : defaults.baseUrl,
        localRepoPath:
          typeof parsed.localRepoPath === 'string'
            ? parsed.localRepoPath
            : defaults.localRepoPath,
        environment:
          typeof parsed.environment === 'string'
            ? parsed.environment
            : defaults.environment,
      }
    } catch {
      return defaults
    }
  })
  const [pendingSandbox, setPendingSandbox] = useState<
    (SandboxRequest & { sessionId: string }) | null
  >(null)
  const [sandboxSubmitting, setSandboxSubmitting] = useState(false)

  // UI State for collapsible sections
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())
  const [expandAll, setExpandAll] = useState(false)

  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    autoApproveSandboxRef.current = autoApproveSandbox
  }, [autoApproveSandbox])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  const activeSession = activeSessionId ? (sessionsById[activeSessionId] ?? null) : null

  const runningSession = useMemo(() => {
    const running = Object.values(sessionsById)
      .filter((session) => session.isReviewing)
      .sort((a, b) => b.startTime - a.startTime)
    return running[0] ?? null
  }, [sessionsById])

  const computeToolStepIndices = (logs: Log[]) =>
    logs
      .map((log, index) => ({ log, index }))
      .filter(
        ({ log }) =>
          log.type === 'step' && log.step?.toolCalls && log.step.toolCalls.length > 0
      )
      .map(({ index }) => index)

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

  const openSession = (sessionId: string) => {
    const session = sessionsById[sessionId]
    if (!session) return
    activeSessionIdRef.current = sessionId
    setActiveSessionId(sessionId)
    setExpandedSteps(new Set(computeToolStepIndices(session.logs)))
    setExpandAll(false)
    setView('review')
  }

  const startReview = async () => {
    if (!modelString) return

    if (runningSession) {
      openSession(runningSession.id)
      return
    }

    // Create new session
    setPendingSandbox(null)
    setExpandedSteps(new Set())
    setExpandAll(false)
    const newSession: ReviewSession = {
      id: `${Date.now()}`,
      modelString,
      logs: [],
      files: [],
      finalResult: null,
      isReviewing: true,
      startTime: Date.now(),
    }
    setSessionsById((prev) => ({ ...prev, [newSession.id]: newSession }))
    activeSessionIdRef.current = newSession.id
    setActiveSessionId(newSession.id)
    setView('review')
    setShowConfig(false)

    try {
      let receivedTerminalEvent = false
      let sessionLogCount = 0
      const response = await fetch(`${API_BASE_URL}/api/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelString,
          isLocal: config.environment === 'local',
          apiKey: config.apiKey || undefined,
          baseUrl: config.baseUrl || undefined,
          environment: config.environment,
          repoPath:
            config.environment === 'local' && config.localRepoPath.trim()
              ? config.localRepoPath.trim()
              : undefined,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        throw new Error(
          `Failed to start review (${response.status})${errorBody ? `: ${errorBody}` : ''}`
        )
      }

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

          const payload = event.startsWith('data: ')
            ? event.slice(6)
            : event.startsWith('data:')
              ? event.slice(5)
              : null
          if (!payload) continue

          try {
            const data = JSON.parse(payload.trimStart()) as Omit<Log, 'timestamp'>
            if (data.type === 'ping') {
              continue
            }

            newLogs.push({ ...data, timestamp: Date.now() })

            if (data.type === 'sandbox_request') {
              if (!data.requestId || !data.command || !data.cwd) {
                throw new Error('Invalid sandbox_request payload')
              }
              const request: SandboxRequest = {
                requestId: data.requestId,
                command: data.command,
                cwd: data.cwd,
                timeout: data.timeout,
              }

              if (autoApproveSandboxRef.current) {
                void submitSandboxDecision(
                  { ...request, sessionId: newSession.id },
                  true,
                  'auto'
                )
              } else {
                setPendingSandbox({ ...request, sessionId: newSession.id })
              }
            }
          } catch (parseError) {
            console.error('Failed to parse SSE event', parseError)
          }
        }

        if (newLogs.length === 0) continue

        const toolStepIndices = newLogs
          .map((log, offset) => ({ log, index: sessionLogCount + offset }))
          .filter(
            ({ log }) =>
              log.type === 'step' && log.step?.toolCalls && log.step.toolCalls.length > 0
          )
          .map(({ index }) => index)

        if (toolStepIndices.length > 0) {
          if (activeSessionIdRef.current === newSession.id) {
            setExpandedSteps((prev) => {
              const next = new Set(prev)
              for (const index of toolStepIndices) next.add(index)
              return next
            })
          }
        }

        sessionLogCount += newLogs.length

        if (newLogs.some((log) => log.type === 'complete' || log.type === 'error')) {
          receivedTerminalEvent = true
        }

        setSessionsById((prev) => {
          const current = prev[newSession.id]
          if (!current) return prev
          const updated: ReviewSession = {
            ...current,
            logs: [...current.logs, ...newLogs],
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

          return { ...prev, [newSession.id]: updated }
        })

        if (receivedTerminalEvent) {
          try {
            await reader.cancel()
          } catch {
            // ignore
          }
          break
        }
      }

      if (!receivedTerminalEvent) {
        setSessionsById((prev) => {
          const current = prev[newSession.id]
          if (!current) return prev
          return {
            ...prev,
            [newSession.id]: {
              ...current,
              isReviewing: false,
              completedAt: current.completedAt ?? Date.now(),
              logs: [
                ...current.logs,
                {
                  type: 'error',
                  message: '连接已中断（未收到完成信号）。请重试或检查后端日志。',
                  timestamp: Date.now(),
                },
              ],
            },
          }
        })
      }
    } catch (error) {
      console.error(error)
      setSessionsById((prev) => {
        const current = prev[newSession.id]
        if (!current) return prev
        return {
          ...prev,
          [newSession.id]: {
            ...current,
            isReviewing: false,
            completedAt: current.completedAt ?? Date.now(),
            logs: [
              ...current.logs,
              {
                type: 'error',
                message: error instanceof Error ? error.message : 'Unknown error',
                timestamp: Date.now(),
              },
            ],
          },
        }
      })
    }
  }

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
    const stored = window.localStorage.getItem(AUTO_APPROVE_STORAGE_KEY)
    if (stored) {
      setAutoApproveSandbox(stored === 'true')
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 50)))
  }, [history])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(AUTO_APPROVE_STORAGE_KEY, String(autoApproveSandbox))
  }, [autoApproveSandbox])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
  }, [config])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(MODEL_STORAGE_KEY, modelString)
  }, [modelString])

  useEffect(() => {
    const sessions = Object.values(sessionsById)
    if (sessions.length === 0) return

    setHistory((prev) => {
      let next = prev
      let changed = false

      for (const session of sessions) {
        if (session.isReviewing) continue
        if (prev.some((entry) => entry.id === session.id)) continue

        const snapshot = cloneSession({
          ...session,
          completedAt: session.completedAt ?? Date.now(),
        })
        next = changed ? next : [...next]
        next.unshift(snapshot)
        changed = true
      }

      return changed ? next.slice(0, 50) : prev
    })
  }, [sessionsById])

  const submitSandboxDecision = async (
    request: SandboxRequest & { sessionId: string },
    approved: boolean,
    source: 'manual' | 'auto'
  ) => {
    setSandboxSubmitting(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/sandbox/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.requestId,
          approved,
        }),
      })

      if (!response.ok) {
        throw new Error('提交沙盒决策失败')
      }

      const decisionLog: Log = {
        type: 'status',
        message: approved
          ? `${source === 'auto' ? '已自动批准' : '已批准'}沙盒验证：${request.command}`
          : `${source === 'auto' ? '已自动拒绝' : '已拒绝'}沙盒验证：${request.command}`,
        timestamp: Date.now(),
      }

      setSessionsById((prev) => {
        const current = prev[request.sessionId]
        if (!current) return prev
        return {
          ...prev,
          [request.sessionId]: {
            ...current,
            logs: [...current.logs, decisionLog],
          },
        }
      })

      setPendingSandbox((prev) => (prev?.requestId === request.requestId ? null : prev))
    } catch (error) {
      setSessionsById((prev) => {
        const current = prev[request.sessionId]
        if (!current) return prev
        return {
          ...prev,
          [request.sessionId]: {
            ...current,
            logs: [
              ...current.logs,
              {
                type: 'error',
                message: error instanceof Error ? error.message : '无法提交沙盒审批结果',
                timestamp: Date.now(),
              },
            ],
          },
        }
      })
    } finally {
      setSandboxSubmitting(false)
    }
  }

  const respondToSandbox = async (approved: boolean) => {
    if (!pendingSandbox) return
    await submitSandboxDecision(pendingSandbox, approved, 'manual')
  }

  const openHistorySession = (session: ReviewSession) => {
    const cloned = cloneSession(session)
    setSessionsById((prev) => ({ ...prev, [cloned.id]: cloned }))
    activeSessionIdRef.current = cloned.id
    setActiveSessionId(cloned.id)
    setExpandedSteps(new Set(computeToolStepIndices(cloned.logs)))
    setExpandAll(false)
    setView('review')
  }

  return (
    <Layout
      view={view}
      setView={setView}
      activeSession={activeSession}
      runningSession={runningSession}
      openRunningSession={() => {
        if (runningSession) {
          openSession(runningSession.id)
        }
      }}
    >
      <AnimatePresence mode="sync">
        {view === 'home' ? (
          <motion.div
            key="home"
            className="view-layer"
            initial={{ opacity: 0.98, y: 12, filter: 'blur(0px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{
              opacity: 0.14,
              y: -12,
              filter: 'blur(28px) brightness(0.18) saturate(0.7)',
            }}
            transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          >
            <Home
              modelString={modelString}
              setModelString={setModelString}
              startReview={startReview}
              setShowConfig={setShowConfig}
              isReviewing={Boolean(runningSession)}
            />
          </motion.div>
        ) : view === 'review' ? (
          <motion.div
            key="review"
            className="view-layer"
            initial={{ opacity: 0.98, y: 10, filter: 'blur(0px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0.14, y: -10, filter: 'blur(18px) brightness(0.22)' }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <ReviewSessionComponent
              activeSession={activeSession}
              setView={setView}
              expandedSteps={expandedSteps}
              toggleStep={toggleStep}
              expandAll={expandAll}
              toggleExpandAll={toggleExpandAll}
              logsEndRef={logsEndRef}
              autoApproveSandbox={autoApproveSandbox}
              setAutoApproveSandbox={setAutoApproveSandbox}
            />
          </motion.div>
        ) : (
          <motion.div
            key="history"
            className="view-layer"
            initial={{ opacity: 0.98, y: 10, filter: 'blur(0px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0.14, y: -10, filter: 'blur(18px) brightness(0.22)' }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <History
              history={history}
              openSession={openHistorySession}
              activeSession={activeSession}
              runningSession={runningSession}
              openRunningSession={() => {
                if (runningSession) {
                  openSession(runningSession.id)
                }
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ConfigModal
        isOpen={showConfig}
        onClose={() => setShowConfig(false)}
        config={config}
        onSave={setConfig}
        apiBaseUrl={API_BASE_URL}
      />

      {pendingSandbox && (
        <div className="modal-overlay">
          <motion.div
            initial={{ opacity: 0.14, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0.14, scale: 0.94, y: 12 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20, mass: 0.8 }}
            className="sandbox-modal"
          >
            <div className="modal-header">
              <div className="modal-title">
                <Icon icon="lucide:shield-check" width={18} height={18} />
                <h2>沙盒验证请求</h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setPendingSandbox(null)}
                aria-label="Close sandbox approval"
              >
                <Icon icon="lucide:x" width={18} height={18} />
              </button>
            </div>

            <div className="sandbox-meta">
              <p className="sandbox-label">命令</p>
              <pre className="sandbox-code">{pendingSandbox.command}</pre>
              <p className="sandbox-label">工作目录</p>
              <pre className="sandbox-code">{pendingSandbox.cwd}</pre>
              {pendingSandbox.timeout ? (
                <p className="sandbox-hint">超时：{pendingSandbox.timeout} ms</p>
              ) : null}
              <p className="sandbox-hint">
                每次沙盒执行都需要手动批准。确认后，代理将在隔离副本中运行该命令。
              </p>
            </div>

            <div className="sandbox-actions">
              <button
                type="button"
                className="sandbox-btn sandbox-btn--deny"
                onClick={() => respondToSandbox(false)}
                disabled={sandboxSubmitting}
              >
                拒绝
              </button>
              <button
                type="button"
                className="sandbox-btn sandbox-btn--approve"
                onClick={() => respondToSandbox(true)}
                disabled={sandboxSubmitting}
              >
                批准
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </Layout>
  )
}

export default App
