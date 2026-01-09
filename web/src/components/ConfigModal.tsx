import { Icon } from '@iconify/react'
import { AnimatePresence, motion } from 'framer-motion'
import type React from 'react'
import { useEffect, useState } from 'react'

export interface ConfigSettings {
  apiKey: string
  environment: string
  baseUrl: string
  localRepoPath: string
  githubPrUrl: string
}

type EffectiveLlmConfig = {
  baseUrl: string
  baseUrlSource: 'env' | 'file' | 'missing'
  apiKeyMasked: string
  apiKeySource: 'env' | 'file' | 'missing'
  hasApiKey: boolean
}

type LocalRepoEntry = {
  name: string
  path: string
}

type LocalRepoResponse = {
  repos: LocalRepoEntry[]
  truncated?: boolean
  roots?: string[]
  maxDepth?: number
  maxResults?: number
  current?: string
}

interface ConfigModalProps {
  isOpen: boolean
  onClose: () => void
  config: ConfigSettings
  onSave: (newConfig: ConfigSettings) => void
  apiBaseUrl: string
}

export const ConfigModal: React.FC<ConfigModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
  apiBaseUrl,
}) => {
  const [activeTab, setActiveTab] = useState('general')
  const [localConfig, setLocalConfig] = useState(config)
  const [effective, setEffective] = useState<EffectiveLlmConfig | null>(null)
  const [localRepos, setLocalRepos] = useState<LocalRepoEntry[]>([])
  const [repoMeta, setRepoMeta] = useState<{
    current?: string
    truncated?: boolean
    roots?: string[]
    maxDepth?: number
    maxResults?: number
  } | null>(null)
  const [repoStatus, setRepoStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  )
  const [repoError, setRepoError] = useState<string | null>(null)

  useEffect(() => {
    setLocalConfig(config)
  }, [config])

  const effectiveRepoPath =
    localConfig.environment === 'local' ? localConfig.localRepoPath.trim() : ''

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    const fetchEffective = async () => {
      try {
        const effectiveUrl = new URL('/api/llm/effective', apiBaseUrl)
        if (effectiveRepoPath) {
          effectiveUrl.searchParams.set('repoPath', effectiveRepoPath)
        }
        const response = await fetch(effectiveUrl.toString())
        if (!response.ok) throw new Error('无法获取当前生效的 API 配置')
        const data = (await response.json()) as EffectiveLlmConfig
        if (!cancelled) setEffective(data)
      } catch {
        if (!cancelled) {
          setEffective({
            baseUrl: '',
            baseUrlSource: 'missing',
            apiKeyMasked: '',
            apiKeySource: 'missing',
            hasApiKey: false,
          })
        }
      }
    }

    void fetchEffective()

    return () => {
      cancelled = true
    }
  }, [apiBaseUrl, effectiveRepoPath, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen || activeTab !== 'environment' || localConfig.environment !== 'local') {
      return
    }
    let cancelled = false

    const fetchRepos = async () => {
      setRepoStatus('loading')
      setRepoError(null)
      try {
        const repoUrl = new URL('/api/local/repos', apiBaseUrl)
        const response = await fetch(repoUrl.toString())
        if (!response.ok) throw new Error('无法扫描本地 Git 仓库')
        const data = (await response.json()) as LocalRepoResponse
        if (cancelled) return
        setLocalRepos(data.repos ?? [])
        setRepoMeta({
          current: data.current || undefined,
          truncated: data.truncated,
          roots: data.roots,
          maxDepth: data.maxDepth,
          maxResults: data.maxResults,
        })
        setRepoStatus('ready')
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : '无法扫描本地 Git 仓库'
        setRepoError(message)
        setRepoStatus('error')
        setLocalRepos([])
        setRepoMeta(null)
      }
    }

    void fetchRepos()

    return () => {
      cancelled = true
    }
  }, [activeTab, apiBaseUrl, isOpen, localConfig.environment])

  const handleChange = (key: string, value: string) => {
    const newConfig = { ...localConfig, [key]: value }
    setLocalConfig(newConfig)
    onSave(newConfig)
  }

  const normalizeBaseUrl = (value: string) => value.trim().replace(/\/$/, '')

  const maskApiKey = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}…`
    return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`
  }

  const effectiveBaseUrl = localConfig.baseUrl.trim()
    ? normalizeBaseUrl(localConfig.baseUrl)
    : effective?.baseUrl
      ? normalizeBaseUrl(effective.baseUrl)
      : ''

  const effectiveApiKeyMasked = localConfig.apiKey.trim()
    ? maskApiKey(localConfig.apiKey)
    : (effective?.apiKeyMasked ?? '')

  const effectiveApiKeySource = localConfig.apiKey.trim()
    ? 'custom'
    : (effective?.apiKeySource ?? 'missing')

  const effectiveBaseUrlSource = localConfig.baseUrl.trim()
    ? 'custom'
    : (effective?.baseUrlSource ?? 'missing')

  const navItems = [
    { id: 'general', label: '常规设置', icon: 'lucide:settings' },
    { id: 'api', label: 'API 配置', icon: 'lucide:key' },
    { id: 'environment', label: '环境', icon: 'lucide:globe' },
    { id: 'advanced', label: '高级设置', icon: 'lucide:terminal' },
  ]

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="modal-overlay"
          onClick={onClose}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0.12, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0.12, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22, mass: 0.8 }}
            className="settings-modal"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sidebar */}
            <div className="settings-sidebar">
              {navItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`settings-nav-item ${activeTab === item.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <Icon icon={item.icon} width={18} height={18} />
                  {item.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="settings-content">
              <div className="settings-header">
                <h2 className="settings-title">
                  {navItems.find((i) => i.id === activeTab)?.label}
                </h2>
                <button
                  type="button"
                  className="close-btn"
                  aria-label="Close settings"
                  onClick={onClose}
                >
                  <Icon icon="lucide:x" width={20} height={20} />
                </button>
              </div>

              {activeTab === 'general' && (
                <>
                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label" htmlFor="settings-language">
                        语言
                      </label>
                      <p className="settings-description">选择界面和审查的语言。</p>
                    </div>
                    <div className="settings-control">
                      <select id="settings-language" className="settings-select">
                        <option>中文</option>
                        <option>English</option>
                        <option>Japanese</option>
                      </select>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label" htmlFor="settings-theme">
                        主题
                      </label>
                      <p className="settings-description">选择您喜欢的视觉主题。</p>
                    </div>
                    <div className="settings-control">
                      <select id="settings-theme" className="settings-select">
                        <option>深色</option>
                        <option>浅色</option>
                        <option>系统</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'api' && (
                <>
                  <div className="settings-row">
                    <div className="settings-info">
                      <div className="settings-label">当前生效</div>
                      <p className="settings-description">
                        展示本次将用于模型调用的实际配置（自定义优先，其次使用服务端默认）。
                      </p>
                    </div>
                    <div className="settings-control">
                      <div className="effective-config">
                        <div className="effective-configRow">
                          <span className="effective-configLabel">API Key</span>
                          <span className="effective-configValue">
                            {effectiveApiKeyMasked || '未配置'}
                          </span>
                          <span className="effective-configSource">
                            {effectiveApiKeySource === 'custom'
                              ? '自定义'
                              : effectiveApiKeySource === 'env'
                                ? '环境变量'
                                : effectiveApiKeySource === 'file'
                                  ? '凭据文件'
                                  : '缺失'}
                          </span>
                        </div>
                        <div className="effective-configRow">
                          <span className="effective-configLabel">Base URL</span>
                          <span className="effective-configValue">
                            {effectiveBaseUrl || '未配置'}
                          </span>
                          <span className="effective-configSource">
                            {effectiveBaseUrlSource === 'custom'
                              ? '自定义'
                              : effectiveBaseUrlSource === 'env'
                                ? '环境变量'
                                : effectiveBaseUrlSource === 'file'
                                  ? '凭据文件'
                                  : '缺失'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label" htmlFor="settings-apiKey">
                        API 密钥
                      </label>
                      <p className="settings-description">
                        您的 OpenAI 或兼容的 API 密钥。
                      </p>
                    </div>
                    <div className="settings-control">
                      <input
                        id="settings-apiKey"
                        type="password"
                        value={localConfig.apiKey}
                        onChange={(e) => handleChange('apiKey', e.target.value)}
                        className="settings-input"
                        placeholder={
                          effective?.apiKeyMasked ? effective.apiKeyMasked : 'sk-...'
                        }
                      />
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label" htmlFor="settings-baseUrl">
                        基础 URL
                      </label>
                      <p className="settings-description">覆盖默认的 API 端点。</p>
                    </div>
                    <div className="settings-control">
                      <input
                        id="settings-baseUrl"
                        type="text"
                        value={localConfig.baseUrl}
                        onChange={(e) => handleChange('baseUrl', e.target.value)}
                        className="settings-input"
                        placeholder={
                          effective?.baseUrl
                            ? normalizeBaseUrl(effective.baseUrl)
                            : 'https://api.openai.com/v1'
                        }
                      />
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'environment' && (
                <>
                  <div className="settings-row">
                    <div className="settings-info">
                      <label className="settings-label" htmlFor="settings-environment">
                        环境
                      </label>
                      <p className="settings-description">选择执行环境。</p>
                    </div>
                    <div className="settings-control">
                      <select
                        id="settings-environment"
                        value={localConfig.environment}
                        onChange={(e) => handleChange('environment', e.target.value)}
                        className="settings-select"
                      >
                        <option value="local">本地</option>
                        <option value="github">GitHub PR</option>
                      </select>
                    </div>
                  </div>

                  {localConfig.environment === 'local' && (
                    <div className="settings-row">
                      <div className="settings-info">
                        <label className="settings-label" htmlFor="settings-local-repo">
                          本地仓库
                        </label>
                        <p className="settings-description">选择需要审查的 Git 仓库。</p>
                        {repoMeta?.roots && repoMeta.roots.length > 0 ? (
                          <p className="settings-description">
                            扫描范围：{repoMeta.roots.join(', ')}
                          </p>
                        ) : null}
                      </div>
                      <div className="settings-control">
                        <select
                          id="settings-local-repo"
                          value={localConfig.localRepoPath}
                          onChange={(e) => handleChange('localRepoPath', e.target.value)}
                          className="settings-select"
                          disabled={repoStatus === 'loading'}
                        >
                          <option value="">
                            {repoMeta?.current
                              ? `当前仓库 (${repoMeta.current})`
                              : '当前仓库'}
                          </option>
                          {localConfig.localRepoPath &&
                          !localRepos.some(
                            (repo) => repo.path === localConfig.localRepoPath
                          ) ? (
                            <option value={localConfig.localRepoPath}>
                              自定义 · {localConfig.localRepoPath}
                            </option>
                          ) : null}
                          {localRepos.map((repo) => (
                            <option key={repo.path} value={repo.path}>
                              {repo.name} · {repo.path}
                            </option>
                          ))}
                        </select>

                        {repoStatus === 'loading' ? (
                          <div className="settings-hint">正在扫描本地仓库…</div>
                        ) : null}
                        {repoStatus === 'error' && repoError ? (
                          <div className="settings-hint settings-hint--error">
                            {repoError}
                          </div>
                        ) : null}
                        {repoStatus === 'ready' && localRepos.length === 0 ? (
                          <div className="settings-hint">未找到 Git 仓库。</div>
                        ) : null}
                        {repoStatus === 'ready' && repoMeta?.truncated ? (
                          <div className="settings-hint">
                            列表已截断，仅显示前{' '}
                            {repoMeta.maxResults ?? localRepos.length} 个仓库。
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {localConfig.environment === 'github' && (
                    <div className="settings-row">
                      <div className="settings-info">
                        <label className="settings-label" htmlFor="settings-github-pr">
                          GitHub PR
                        </label>
                        <p className="settings-description">
                          输入要审查的 Pull Request 链接。
                        </p>
                      </div>
                      <div className="settings-control">
                        <input
                          id="settings-github-pr"
                          type="text"
                          value={localConfig.githubPrUrl}
                          onChange={(e) => handleChange('githubPrUrl', e.target.value)}
                          className="settings-input"
                          placeholder="https://github.com/owner/repo/pull/123"
                        />
                        <div className="settings-hint">
                          支持：<code>https://github.com/owner/repo/pull/123</code> 或{' '}
                          <code>owner/repo#123</code>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'advanced' && (
                <div className="settings-row">
                  <div className="settings-info">
                    <label className="settings-label" htmlFor="settings-debug">
                      调试模式
                    </label>
                    <p className="settings-description">
                      启用详细日志记录以进行故障排除。
                    </p>
                  </div>
                  <div className="settings-control">
                    <select id="settings-debug" className="settings-select">
                      <option>关闭</option>
                      <option>开启</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="settings-footer">
                <button type="button" className="settings-primary-btn" onClick={onClose}>
                  保存并关闭
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
