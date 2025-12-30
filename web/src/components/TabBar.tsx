import { Icon } from '@iconify/react'

type View = 'home' | 'review' | 'history'

interface TabBarProps {
  view: View
  setView: (view: View) => void
  hasReviewSession: boolean
  isReviewing: boolean
}

export function TabBar({ view, setView, hasReviewSession, isReviewing }: TabBarProps) {
  const tabs: Array<{
    id: View
    label: string
    icon: string
    disabled?: boolean
    badge?: boolean
  }> = [
    { id: 'home', label: '首页', icon: 'lucide:home' },
    {
      id: 'review',
      label: '审查',
      icon: 'lucide:scan-text',
      disabled: !hasReviewSession,
      badge: isReviewing,
    },
    { id: 'history', label: '历史', icon: 'lucide:clock-3' },
  ]

  return (
    <nav className="tabbar" aria-label="Navigation">
      <div className="tabbar-inner">
        {tabs.map((tab) => {
          const isActive = view === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              className={`tabbar-btn${isActive ? ' tabbar-btn--active' : ''}`}
              onClick={() => setView(tab.id)}
              disabled={tab.disabled}
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.label}
            >
              <span className="tabbar-iconWrap" aria-hidden>
                <Icon icon={tab.icon} width={18} height={18} />
                {tab.badge ? <span className="tabbar-badge" /> : null}
              </span>
              <span className="tabbar-label">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
