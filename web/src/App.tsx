import { Icon } from '@iconify/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { ConfigModal, type ConfigSettings } from './components/ConfigModal'
import { Home } from './components/Home'
import { Layout } from './components/Layout'
import { ReviewSession as ReviewSessionComponent } from './components/ReviewSession'
import type { Log, ReviewSession, SandboxRequest } from './types'

const DEFAULT_MODEL = 'openai:GLM-4-FlashX-250414'
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
  const [pendingSandbox, setPendingSandbox] = useState<SandboxRequest | null>(null)
  const [sandboxSubmitting, setSandboxSubmitting] = useState(false)

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
    setPendingSandbox(null)
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
      let receivedTerminalEvent = false
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

          if (!event.startsWith('data: ')) continue

          try {
            const data = JSON.parse(event.slice(6)) as Omit<Log, 'timestamp'>
            if (data.type === 'ping') {
              continue
            }

            newLogs.push({ ...data, timestamp: Date.now() })

            if (data.type === 'sandbox_request') {
              if (!data.requestId || !data.command || !data.cwd) {
                throw new Error('Invalid sandbox_request payload')
              }
              setPendingSandbox({
                requestId: data.requestId,
                command: data.command,
                cwd: data.cwd,
                timeout: data.timeout,
              })
            }
          } catch (parseError) {
            console.error('Failed to parse SSE event', parseError)
          }
        }

        if (newLogs.length === 0) continue

        if (newLogs.some((log) => log.type === 'complete' || log.type === 'error')) {
          receivedTerminalEvent = true
        }

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
                message: '连接已中断（未收到完成信号）。请重试或检查后端日志。',
                timestamp: Date.now(),
              },
            ],
          }
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

  const respondToSandbox = async (approved: boolean) => {
    if (!pendingSandbox) return
    setSandboxSubmitting(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/sandbox/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: pendingSandbox.requestId,
          approved,
        }),
      })

      if (!response.ok) {
        throw new Error('提交沙盒决策失败')
      }

      const decisionLog: Log = {
        type: 'status',
        message: approved
          ? `已批准沙盒验证：${pendingSandbox.command}`
          : `已拒绝沙盒验证：${pendingSandbox.command}`,
        timestamp: Date.now(),
      }

      setActiveSession((prev) =>
        prev
          ? {
              ...prev,
              logs: [...prev.logs, decisionLog],
            }
          : prev
      )

      setPendingSandbox(null)
    } catch (error) {
      setActiveSession((prev) =>
        prev
          ? {
              ...prev,
              logs: [
                ...prev.logs,
                {
                  type: 'error',
                  message:
                    error instanceof Error ? error.message : '无法提交沙盒审批结果',
                  timestamp: Date.now(),
                },
              ],
            }
          : prev
      )
    } finally {
      setSandboxSubmitting(false)
    }
  }

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

      {pendingSandbox && (
        <div className="modal-overlay">
          <motion.div
            initial={{ opacity: 0.14, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0.14, scale: 0.94, y: 12 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
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
