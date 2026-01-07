import { Icon } from '@iconify/react'
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import type { ReviewSession } from '../types'
import { TabBar } from './TabBar'

interface LayoutProps {
  children: ReactNode
  view: 'home' | 'review' | 'history'
  setView: (view: 'home' | 'review' | 'history') => void
  activeSession: ReviewSession | null
  runningSession: ReviewSession | null
  openRunningSession: () => void
}

export function Layout({
  children,
  view,
  setView,
  activeSession,
  runningSession,
  openRunningSession,
}: LayoutProps) {
  return (
    <div className="app-shell">
      <header className={`app-header${view === 'home' ? ' app-header--home' : ''}`}>
        <div className="app-headerBrand">CoStrict-Code Review</div>

        {runningSession?.isReviewing && (
          <motion.button
            initial={{ opacity: 0.08, y: -10, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ type: 'spring', stiffness: 320, damping: 22, mass: 0.7 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={openRunningSession}
            className="app-headerPill"
            type="button"
          >
            <Icon icon="lucide:activity" width={16} height={16} />
            审查进行中...
          </motion.button>
        )}
      </header>

      <main className={view === 'home' ? 'app-main app-main--home' : 'app-main'}>
        {children}
      </main>

      <TabBar
        view={view}
        setView={(target) => {
          if (target === 'review' && runningSession?.isReviewing) {
            openRunningSession()
            return
          }
          setView(target)
        }}
        hasReviewSession={Boolean(activeSession) || Boolean(runningSession)}
        isReviewing={Boolean(runningSession?.isReviewing)}
      />
    </div>
  )
}
