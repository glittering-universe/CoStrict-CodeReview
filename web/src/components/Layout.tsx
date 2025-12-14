import { motion } from 'framer-motion'
import { Activity } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ReviewSession } from '../types'

interface LayoutProps {
    children: ReactNode
    view: 'home' | 'review'
    setView: (view: 'home' | 'review') => void
    activeSession: ReviewSession | null
    lang: 'en' | 'zh' // 新增参数
}

export function Layout({ children, view, setView, activeSession, lang }: LayoutProps) {
    const t = {
        reviewing: lang === 'zh' ? '审查进行中...' : 'Review in Progress...',
        marqueeTop: lang === 'zh' 
            ? 'COSTRICT-CODEREVIEW 2025 • AI 代码审查 • COSTRICT-CODEREVIEW 2025 • AI 代码审查 • 视觉盛宴 • 快速发布 •'
            : 'Costrict-CodeReview 2025 • AI CODE REVIEW • VISUAL EUPHORIA • SHIP FASTER • Costrict-CodeReview 2025 • AI CODE REVIEW • VISUAL EUPHORIA • SHIP FASTER •',
        marqueeBottom: lang === 'zh'
            ? '专为速度优化 • 为工程师打造 • COSTRICT-CODEREVIEW 2025 • 为工程师打造 • COSTRICT-CODEREVIEW 2025 •'
            : 'OPTIMIZED FOR SPEED • BUILT FOR ENGINEERS • Costrict-CodeReview 2025 • OPTIMIZED FOR SPEED • BUILT FOR ENGINEERS • Costrict-CodeReview 2025 •'
    }

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
<<<<<<< HEAD
                            {t.marqueeTop}
=======
                            CoStrict-Code Review 2025 • AI 代码审查 • 严格代码检查 • 提高代码质量 • CoStrict-Code Review 2025 • AI 代码审查 • 严格代码检查 • 提高代码质量 •
>>>>>>> main
                        </div>
                    </div>

                    <div className="marquee-container marquee-bottom">
                        <div className="marquee-content" style={{ animationDirection: 'reverse' }}>
<<<<<<< HEAD
                            {t.marqueeBottom}
=======
                            优化速度 • 为工程师构建 • CoStrict-Code Review 2025 • 优化速度 • 为工程师构建 • CoStrict-Code Review 2025 •
>>>>>>> main
                        </div>
                    </div>
                </>
            )}

            {/* Header */}
            <header className="fixed top-12 left-0 right-0 p-6 flex justify-between items-center z-40 pointer-events-none">
                <div className="text-[var(--text-primary)] font-bold text-xl tracking-widest uppercase pointer-events-auto">
<<<<<<< HEAD
                    Costrict-CodeReview
=======
                    CoStrict-Code Review
>>>>>>> main
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
<<<<<<< HEAD
                        {t.reviewing}
=======
                        审查进行中...
>>>>>>> main
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