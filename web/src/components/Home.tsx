import { Icon } from '@iconify/react'
import { useMemo, useRef } from 'react'
import { GlyphDitherCanvas } from '../visual/GlyphDitherCanvas'

interface HomeProps {
  modelString: string
  setModelString: (model: string) => void
  startReview: () => void
  setShowConfig: (show: boolean) => void
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function Home({
  modelString,
  setModelString,
  startReview,
  setShowConfig,
}: HomeProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  const mouseRef = useRef({ x: 0.5, y: 0.5 })

  const initialQuality = useMemo<1 | 0.75 | 0.5>(() => {
    const isCoarsePointer =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    return isCoarsePointer ? 0.75 : 1
  }, [])

  const renderQuality = initialQuality

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return

    mouseRef.current = {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    }
  }

  return (
    <div ref={rootRef} className="home-root" onPointerMove={onPointerMove}>
      <GlyphDitherCanvas
        className="home-canvas"
        mouse={mouseRef}
        renderQuality={renderQuality}
      />

      <nav className="home-nav home-enter home-enter--1">
        <div className="home-brand">
          <div className="home-brandMark" aria-hidden />
          <div className="home-brandText">
            <div className="home-brandTitle">CoStrict</div>
            <div className="home-brandSubtitle">Glyph Dither Review</div>
          </div>
        </div>

        <div className="home-navActions">
          <div className="home-modelPill">
            <Icon icon="lucide:cpu" width={16} height={16} />
            <input
              className="home-modelInput"
              value={modelString}
              onChange={(e) => setModelString(e.target.value)}
              placeholder="openai:glm-4.5-flash"
            />
          </div>

          <button
            type="button"
            className="home-iconBtn"
            onClick={() => setShowConfig(true)}
            aria-label="Settings"
          >
            <Icon icon="lucide:settings" width={18} height={18} />
          </button>

          <button
            type="button"
            className="home-cta"
            onClick={startReview}
            disabled={!modelString}
          >
            <Icon icon="lucide:play" width={18} height={18} />
            Start Review
          </button>
        </div>
      </nav>
    </div>
  )
}
