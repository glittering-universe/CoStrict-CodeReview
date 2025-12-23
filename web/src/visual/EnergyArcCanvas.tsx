import type { MutableRefObject } from 'react'
import { useEffect, useRef } from 'react'

export type RenderQuality = 1 | 0.75 | 0.5
export type MouseRef = MutableRefObject<{ x: number; y: number }>

interface EnergyArcCanvasProps {
  className?: string
  mouse: MouseRef
  renderQuality?: RenderQuality
}

type Viewport = {
  width: number
  height: number
  scale: number
}

const clamp = (value: number, min: number, max: number) =>
  Number.isNaN(value) ? min : Math.min(max, Math.max(min, value))

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const denom = edge1 - edge0
  if (Math.abs(denom) < 1e-6) return value < edge0 ? 0 : 1
  const t = clamp((value - edge0) / denom, 0, 1)
  return t * t * (3 - 2 * t)
}

const fract = (value: number) => value - Math.floor(value)

const hash1 = (n: number) => fract(Math.sin(n * 12.9898) * 43758.5453123)

type Point = { x: number; y: number }

const computeGeometry = (width: number, height: number) => {
  const minDim = Math.min(width, height)
  // Match the homepage ring: centered, slightly lower.
  const center: Point = { x: width * 0.5, y: height * 0.56 }
  const ringRadius = minDim * 0.54
  // Homepage caustics/glyph band lives mostly outside the ring radius.
  const ringThickness = minDim * 0.17
  const orbitRadius = ringRadius + ringThickness * 0.8
  const ringWidth = clamp(minDim * 0.075, 26, 64)
  const gap = 0
  const arcStart = Math.PI + gap * 0.5
  const arcEnd = Math.PI - gap * 0.5
  const arcSpan = arcEnd + Math.PI * 2 - arcStart

  return {
    minDim,
    center,
    ringRadius,
    ringThickness,
    orbitRadius,
    ringWidth,
    arcStart,
    arcEnd,
    arcSpan,
  }
}

export function EnergyArcCanvas({
  className,
  mouse,
  renderQuality = 1,
}: EnergyArcCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const rafRef = useRef<number | null>(null)

  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const staticCtxRef = useRef<CanvasRenderingContext2D | null>(null)

  const beamCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const beamCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const beamLastUpdateRef = useRef(0)
  const introStartMsRef = useRef<number | null>(null)

  const viewportRef = useRef<Viewport>({
    width: 0,
    height: 0,
    scale: 1,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx =
      canvas.getContext('2d', { alpha: true, desynchronized: true }) ??
      canvas.getContext('2d')
    if (!ctx) return
    ctxRef.current = ctx

    // Size to the canvas itself (fixed / viewport aligned on the review page),
    // so we don't include scrollbars or container offsets.
    const target = canvas

    const rebuildStaticLayer = (cssWidth: number, cssHeight: number, scale: number) => {
      const staticCanvas = staticCanvasRef.current ?? document.createElement('canvas')
      staticCanvasRef.current = staticCanvas

      const pixelWidth = Math.max(1, Math.floor(cssWidth * scale))
      const pixelHeight = Math.max(1, Math.floor(cssHeight * scale))
      if (staticCanvas.width !== pixelWidth) staticCanvas.width = pixelWidth
      if (staticCanvas.height !== pixelHeight) staticCanvas.height = pixelHeight

      const staticCtx =
        staticCtxRef.current ??
        staticCanvas.getContext('2d', { alpha: true, desynchronized: true }) ??
        staticCanvas.getContext('2d')
      if (!staticCtx) return
      staticCtxRef.current = staticCtx

      staticCtx.setTransform(scale, 0, 0, scale, 0, 0)
      staticCtx.globalCompositeOperation = 'source-over'
      staticCtx.globalAlpha = 1
      staticCtx.imageSmoothingEnabled = true
      staticCtx.fillStyle = '#05060a'
      staticCtx.fillRect(0, 0, cssWidth, cssHeight)

      const geometry = computeGeometry(cssWidth, cssHeight)
      const { center, ringRadius, ringWidth, minDim } = geometry

      const vignette = staticCtx.createRadialGradient(
        center.x,
        center.y,
        minDim * 0.12,
        center.x,
        center.y,
        minDim * 0.92
      )
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vignette.addColorStop(0.65, 'rgba(0, 0, 0, 0.34)')
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.72)')
      staticCtx.fillStyle = vignette
      staticCtx.fillRect(0, 0, cssWidth, cssHeight)

      const innerMask = staticCtx.createRadialGradient(
        center.x,
        center.y,
        ringRadius - ringWidth * 2.65,
        center.x,
        center.y,
        ringRadius - ringWidth * 1.05
      )
      innerMask.addColorStop(0, 'rgba(0, 0, 0, 0.92)')
      innerMask.addColorStop(1, 'rgba(0, 0, 0, 0)')
      staticCtx.globalCompositeOperation = 'source-over'
      staticCtx.shadowBlur = 0
      staticCtx.fillStyle = innerMask
      staticCtx.fillRect(0, 0, cssWidth, cssHeight)
    }

    const ensureBeamLayer = (cssWidth: number, cssHeight: number, scale: number) => {
      const beamCanvas = beamCanvasRef.current ?? document.createElement('canvas')
      beamCanvasRef.current = beamCanvas

      const beamScale = clamp(renderQuality * 0.7, 0.35, 0.7)
      const pixelWidth = Math.max(1, Math.floor(cssWidth * scale * beamScale))
      const pixelHeight = Math.max(1, Math.floor(cssHeight * scale * beamScale))
      if (beamCanvas.width !== pixelWidth) beamCanvas.width = pixelWidth
      if (beamCanvas.height !== pixelHeight) beamCanvas.height = pixelHeight

      const beamCtx =
        beamCtxRef.current ??
        beamCanvas.getContext('2d', { alpha: true, desynchronized: true }) ??
        beamCanvas.getContext('2d')
      if (!beamCtx) return
      beamCtxRef.current = beamCtx
    }

    const updateSize = () => {
      const rect = target.getBoundingClientRect()
      const fallbackWidth =
        typeof window !== 'undefined' ? Math.max(1, window.innerWidth) : 1
      const fallbackHeight =
        typeof window !== 'undefined' ? Math.max(1, window.innerHeight) : 1
      const cssWidth = rect.width || fallbackWidth
      const cssHeight = rect.height || fallbackHeight
      const dpr =
        typeof window !== 'undefined' && window.devicePixelRatio
          ? window.devicePixelRatio
          : 1
      const scale = clamp(dpr, 1, 1.6) * renderQuality

      canvas.width = Math.max(1, Math.floor(cssWidth * scale))
      canvas.height = Math.max(1, Math.floor(cssHeight * scale))

      viewportRef.current = {
        width: cssWidth,
        height: cssHeight,
        scale,
      }

      rebuildStaticLayer(cssWidth, cssHeight, scale)
      ensureBeamLayer(cssWidth, cssHeight, scale)
    }

    updateSize()

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateSize)
      observer.observe(target)
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateSize)
    }

    return () => {
      observer?.disconnect()
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', updateSize)
      }
    }
  }, [renderQuality])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `mouse` is a mutable ref read inside an rAF loop.
  useEffect(() => {
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    if (!ctx || !canvas) return

    const draw = (nowMs: number) => {
      const viewport = viewportRef.current
      if (!viewport.width || !viewport.height) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      const { width, height, scale } = viewport
      const nowS = nowMs * 0.001

      if (introStartMsRef.current === null) {
        introStartMsRef.current = nowMs
      }

      const introElapsedS = (nowMs - introStartMsRef.current) * 0.001
      const intro = smoothstep(0.35, 1.95, introElapsedS)
      const bloomIntro = smoothstep(0.55, 2.6, introElapsedS)

      const staticCanvas = staticCanvasRef.current
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.imageSmoothingEnabled = true
      ctx.filter = 'none'

      if (staticCanvas) {
        ctx.drawImage(staticCanvas, 0, 0, width, height)
      } else {
        ctx.fillStyle = '#05060a'
        ctx.fillRect(0, 0, width, height)
      }

      const geometry = computeGeometry(width, height)
      const { center, orbitRadius, ringWidth, arcStart, arcSpan, minDim } = geometry

      const mousePos = mouse.current
      const mouseX = mousePos.x * width
      const mouseY = mousePos.y * height
      const mouseDist = Math.hypot(mouseX - center.x, mouseY - center.y)
      const mouseProximity = Math.exp(
        -(((mouseDist - orbitRadius) / (ringWidth * 3.2)) ** 2)
      )

      const beamCanvas = beamCanvasRef.current
      const beamCtx = beamCtxRef.current
      if (beamCanvas && beamCtx) {
        const beamScale = clamp(renderQuality * 0.7, 0.35, 0.7)
        const nextW = Math.max(1, Math.floor(width * scale * beamScale))
        const nextH = Math.max(1, Math.floor(height * scale * beamScale))
        if (beamCanvas.width !== nextW) beamCanvas.width = nextW
        if (beamCanvas.height !== nextH) beamCanvas.height = nextH

        const beamUpdateEveryMs = 1000 / 30
        if (nowMs - beamLastUpdateRef.current > beamUpdateEveryMs) {
          beamLastUpdateRef.current = nowMs

          beamCtx.setTransform(scale * beamScale, 0, 0, scale * beamScale, 0, 0)
          beamCtx.globalCompositeOperation = 'source-over'
          beamCtx.globalAlpha = 1
          beamCtx.clearRect(0, 0, width, height)

          beamCtx.globalCompositeOperation = 'lighter'
          beamCtx.lineCap = 'round'
          beamCtx.lineJoin = 'round'

          const beamCount = clamp(Math.round(minDim / 22), 36, 64)
          const speed = 0.24
          const mouseBoost = 0.55 + mouseProximity * 0.85
          const baseSteps = clamp(Math.round(minDim / 22), 42, 90)
          const wobbleScale = 0.85

          const strokeWavyBeam = (
            beamRadius: number,
            u0: number,
            u1: number,
            widthPx: number,
            strokeStyle: string,
            alpha: number,
            seed: number,
            wobbleAmp: number
          ) => {
            const span = Math.max(0.0001, Math.abs(u1 - u0))
            const steps = clamp(Math.round(baseSteps * span * 1.65), 18, baseSteps)

            beamCtx.globalAlpha = alpha
            beamCtx.lineWidth = widthPx
            beamCtx.strokeStyle = strokeStyle
            beamCtx.beginPath()

            for (let s = 0; s <= steps; s++) {
              const k = s / steps
              const u = lerp(u0, u1, k)
              const angle = arcStart + u * arcSpan
              const envelope = 0.28 + 0.72 * Math.sin(Math.PI * k)

              const f1 = 3.2 + seed * 4.8
              const f2 = 7.4 + seed * 6.9
              const t1 = nowS * (1.15 + seed * 0.95)
              const t2 = nowS * (0.85 + seed * 1.15)
              const wave =
                Math.sin(angle * f1 + t1 + seed * 12.4) * 0.55 +
                Math.sin(angle * f2 - t2 + seed * 21.1) * 0.35

              const sway =
                Math.sin(angle * 2.3 - nowS * (0.65 + seed * 0.35) + seed * 7.3) * 0.16
              const drift = Math.sin(nowS * (0.55 + seed * 0.75) + seed * 8.1) * 0.12
              const radial = beamRadius + envelope * wobbleAmp * (wave + sway + drift)

              const x = center.x + Math.cos(angle) * radial
              const y = center.y + Math.sin(angle) * radial

              if (s === 0) beamCtx.moveTo(x, y)
              else beamCtx.lineTo(x, y)
            }

            beamCtx.stroke()
          }

          for (let i = 0; i < beamCount; i++) {
            const r0 = hash1(i * 13.7 + 0.31)
            const r1 = hash1(i * 17.1 + 0.71)
            const r2 = hash1(i * 9.2 + 2.3)

            const jitterU = Math.sin(nowS * (0.55 + r2 * 0.6) + i * 0.9) * 0.012
            const centerU = fract(r1 + nowS * speed + i * 0.017 + jitterU)
            const lengthU = 0.045 + r0 * 0.12
            const tailU = centerU - lengthU

            const edgeFade =
              smoothstep(0, 0.05, centerU) * (1 - smoothstep(0.95, 1, centerU))
            const pulse = 0.75 + 0.25 * Math.sin(nowS * 2.2 + i * 0.9)
            const alpha = clamp((0.18 + r2 * 0.42) * edgeFade * pulse * intro, 0.03, 0.92)
            if (alpha < 0.04) continue

            const laneBase = (hash1(i * 5.7 + 6.1) - 0.5) * ringWidth * 0.32
            const laneWave =
              Math.sin(nowS * (0.9 + r1 * 1.4) + r0 * 9.1) * ringWidth * 0.12
            const lane = (laneBase + laneWave) * mouseBoost
            const beamRadius = orbitRadius + lane
            const baseWidth = ringWidth * (0.065 + r0 * 0.06) * (0.85 + mouseBoost * 0.22)
            const wobbleAmp =
              ringWidth *
              (0.42 + r0 * 0.85) *
              (0.72 + r2 * 0.55) *
              mouseBoost *
              wobbleScale

            const headU = centerU
            const segments: Array<[number, number]> =
              tailU >= 0
                ? [[tailU, headU]]
                : [
                    [tailU + 1, 1],
                    [0, headU],
                  ]

            for (const [u0, u1] of segments) {
              strokeWavyBeam(
                beamRadius,
                u0,
                u1,
                baseWidth * 1.75,
                'rgba(240, 167, 88, 1)',
                alpha * 0.14,
                r1 + r2,
                wobbleAmp * 0.85
              )

              strokeWavyBeam(
                beamRadius,
                u0,
                u1,
                baseWidth * 0.92,
                'rgba(255, 252, 242, 1)',
                alpha * 0.62,
                r0 + r2 * 1.7,
                wobbleAmp
              )

              const headSpan = lengthU * 0.28
              const hot0 = clamp(headU - headSpan, 0, 1)
              if (u0 <= hot0 && u1 >= hot0) {
                strokeWavyBeam(
                  beamRadius + ringWidth * 0.06,
                  hot0,
                  headU,
                  baseWidth * 0.34,
                  'rgba(255, 252, 242, 1)',
                  alpha * 0.92,
                  r0 + r1,
                  wobbleAmp * 0.55
                )
              }

              strokeWavyBeam(
                beamRadius - ringWidth * 0.08,
                u0,
                u1,
                baseWidth * 0.34,
                'rgba(255, 214, 150, 1)',
                alpha * 0.14,
                r1 + r2 * 0.6,
                wobbleAmp * 0.65
              )
            }
          }

          const microCount = clamp(Math.round(minDim / 18), 60, 120)
          const microSpeed = 0.46
          for (let i = 0; i < microCount; i++) {
            const s0 = hash1(i * 6.1 + 0.18)
            const s1 = hash1(i * 9.7 + 1.07)
            const s2 = hash1(i * 4.4 + 2.73)

            const headU = fract(s0 + nowS * microSpeed + i * 0.003)
            const lengthU = 0.006 + s1 * 0.02
            const tailU = headU - lengthU
            const edgeFade =
              smoothstep(0, 0.035, headU) * (1 - smoothstep(0.965, 1, headU))
            const alpha = clamp((0.08 + s2 * 0.22) * edgeFade * intro, 0.03, 0.38)
            if (alpha < 0.04) continue

            const lane = (hash1(i * 2.9 + 5.1) - 0.5) * ringWidth * 0.24
            const beamRadius = orbitRadius + ringWidth * 0.22 + lane
            const widthPx = Math.max(1, ringWidth * (0.022 + s1 * 0.02))
            const wobbleAmp =
              ringWidth * (0.08 + s1 * 0.16) * (0.45 + mouseBoost * 0.55) * wobbleScale

            const segments: Array<[number, number]> =
              tailU >= 0
                ? [[tailU, headU]]
                : [
                    [tailU + 1, 1],
                    [0, headU],
                  ]

            for (const [u0, u1] of segments) {
              strokeWavyBeam(
                beamRadius,
                u0,
                u1,
                widthPx,
                'rgba(255, 252, 242, 1)',
                alpha,
                s0 + s2,
                wobbleAmp
              )
            }
          }
        }

        ctx.globalCompositeOperation = 'lighter'
        const heavyBlur = lerp(28, 18, bloomIntro)
        const midBlur = lerp(12, 6, bloomIntro)

        ctx.globalAlpha = intro * 0.75
        ctx.filter = `blur(${heavyBlur}px)`
        ctx.drawImage(beamCanvas, 0, 0, width, height)

        ctx.globalAlpha = intro * 0.8
        ctx.filter = `blur(${midBlur}px)`
        ctx.drawImage(beamCanvas, 0, 0, width, height)

        ctx.globalAlpha = intro
        ctx.filter = 'none'
        ctx.drawImage(beamCanvas, 0, 0, width, height)
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [renderQuality])

  return <canvas ref={canvasRef} className={className} />
}
