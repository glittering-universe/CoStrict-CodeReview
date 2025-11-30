import { motion } from 'framer-motion'
import { Activity } from 'lucide-react'
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
        <div className="min-h-screen flex flex-col relative overflow-hidden">
            {/* Background Elements */}
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[var(--accent)] blur-[150px] opacity-10 pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[var(--bg-gradient-start)] blur-[150px] opacity-20 pointer-events-none" />

            {/* Marquees - Only show on home page */}
            {view === 'home' && (
                <>
                    <div className="marquee-container marquee-top">
                        <div className="marquee-content">
                            SHIPPIE 2025 • AI CODE REVIEW • VISUAL EUPHORIA • SHIP FASTER • SHIPPIE 2025 • AI CODE REVIEW • VISUAL EUPHORIA • SHIP FASTER •
                        </div>
                    </div>

                    <div className="marquee-container marquee-bottom">
                        <div className="marquee-content" style={{ animationDirection: 'reverse' }}>
                            OPTIMIZED FOR SPEED • BUILT FOR ENGINEERS • SHIPPIE 2025 • OPTIMIZED FOR SPEED • BUILT FOR ENGINEERS • SHIPPIE 2025 •
                        </div>
                    </div>
                </>
            )}

            {/* Header */}
            <header className="fixed top-12 left-0 right-0 p-6 flex justify-between items-center z-40 pointer-events-none">
                <div className="text-[var(--text-primary)] font-bold text-xl tracking-widest uppercase pointer-events-auto">
                    Shippie
                </div>

                {/* Active Task Widget */}
                {activeSession && activeSession.isReviewing && view === 'home' && (
                    <motion.button
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        onClick={() => setView('review')}
                        className="pointer-events-auto bg-[var(--card-bg)] backdrop-blur-md border border-[var(--accent)] rounded-full px-4 py-2 flex items-center gap-2 text-sm text-[var(--accent)] hover:bg-[var(--accent)] hover:text-black transition-colors"
                    >
                        <Activity className="w-4 h-4 animate-pulse" />
                        Review in Progress...
                    </motion.button>
                )}
            </header>

            {/* Main Content */}
            <main className="flex-1 flex flex-col items-center justify-center p-4 relative z-30 w-full pt-20 pb-20">
                {children}
            </main>
        </div>
    )
}
