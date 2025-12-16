import { Icon } from '@iconify/react'
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import type { ReviewSession } from '../types'

interface LayoutProps {
  children: ReactNode
  view: 'home' | 'review'
  setView: (view: 'home' | 'review') => void
  activeSession: ReviewSession | null
}

export function Layout({ children, view, setView, activeSession }: LayoutProps) {
  return (
    <div className="app-shell">
      {view !== 'home' && (
        <header className="app-header">
          <div className="app-headerBrand">CoStrict-Code Review</div>

          {activeSession?.isReviewing && (
            <motion.button
              initial={{ opacity: 0.08, y: -10, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              onClick={() => setView('review')}
              className="app-headerPill"
              type="button"
            >
              <Icon icon="lucide:activity" width={16} height={16} />
              审查进行中...
            </motion.button>
          )}
        </header>
      )}

      <main className={view === 'home' ? 'app-main app-main--home' : 'app-main'}>
        {children}
      </main>
    </div>
  )
}
