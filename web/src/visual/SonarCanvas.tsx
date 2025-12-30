import type { MutableRefObject } from 'react'
import { useEffect, useRef } from 'react'

export type RenderQuality = 1 | 0.75 | 0.5

type Point = { x: number; y: number }

type Ripple = {
  origin: Point
  startMs: number
  strength: number
}

export type MouseRef = MutableRefObject<Point>

interface SonarCanvasProps {
  className?: string
  mouse: MouseRef
  renderQuality?: RenderQuality
}

const clamp = (value: number, min: number, max: number) =>
  Number.isNaN(value) ? min : Math.min(max, Math.max(min, value))

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const denom = edge1 - edge0
  if (Math.abs(denom) < 1e-6) return value < edge0 ? 0 : 1
  const t = clamp((value - edge0) / denom, 0, 1)
  return t * t * (3 - 2 * t)
}

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b))

export function SonarCanvas({ className, mouse, renderQuality = 1 }: SonarCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const rafRef = useRef<number | null>(null)

  const viewportRef = useRef({
    width: 0,
    height: 0,
    scale: 1,
  })

  const rippleRef = useRef<Ripple[]>([])
  const mouseStateRef = useRef({
    last: { x: 0.5, y: 0.5 },
    lastMs: 0,
    energy: 0,
    lastSpawnMs: 0,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx =
      canvas.getContext('2d', { alpha: true, desynchronized: true }) ??
      canvas.getContext('2d')
    if (!ctx) return
    ctxRef.current = ctx

    const target = canvas.parentElement ?? canvas
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
      const scale = clamp(dpr, 1, 2) * renderQuality

      const nextWidth = Math.max(1, Math.floor(cssWidth * scale))
      const nextHeight = Math.max(1, Math.floor(cssHeight * scale))
      if (canvas.width !== nextWidth) canvas.width = nextWidth
      if (canvas.height !== nextHeight) canvas.height = nextHeight

      viewportRef.current = {
        width: cssWidth,
        height: cssHeight,
        scale,
      }
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
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1

      ctx.fillStyle = '#05060a'
      ctx.fillRect(0, 0, width, height)

      const cx = width * 0.5
      const cy = height * 0.5
      const minDim = Math.min(width, height)
      const maxR = Math.hypot(width, height) * 0.52

      const baseGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR)
      baseGlow.addColorStop(0, 'rgba(167, 139, 250, 0.22)')
      baseGlow.addColorStop(0.35, 'rgba(14, 165, 233, 0.12)')
      baseGlow.addColorStop(0.75, 'rgba(16, 185, 129, 0.055)')
      baseGlow.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = baseGlow
      ctx.fillRect(0, 0, width, height)

      const t = nowMs * 0.001
      const ringGap = clamp(minDim * 0.085, 56, 140)
      const ringSpeed = minDim * 0.22
      const offset = (t * ringSpeed) % ringGap

      const currentMouse = mouse.current
      const mousePx = {
        x: currentMouse.x * width,
        y: currentMouse.y * height,
      }
      const mouseAngle = Math.atan2(mousePx.y - cy, mousePx.x - cx)
      const mouseDistNorm = clamp(Math.hypot(mousePx.x - cx, mousePx.y - cy) / maxR, 0, 1)

      const mouseState = mouseStateRef.current
      const last = mouseState.last
      const lastMs = mouseState.lastMs || nowMs
      const dt = Math.max(1, nowMs - lastMs)
      const dxPx = (currentMouse.x - last.x) * width
      const dyPx = (currentMouse.y - last.y) * height
      const speedPx = Math.hypot(dxPx, dyPx) / (dt * 0.001)

      const speedSignal = clamp(speedPx / (minDim * 1.6), 0, 1)
      mouseState.energy = clamp(mouseState.energy * 0.9 + speedSignal * 0.65, 0, 1)

      if (speedPx > 24 && nowMs - mouseState.lastSpawnMs > 48) {
        rippleRef.current.push({
          origin: { x: mousePx.x, y: mousePx.y },
          startMs: nowMs,
          strength: clamp(0.18 + speedSignal * 0.9, 0.18, 1),
        })
        mouseState.lastSpawnMs = nowMs
        if (rippleRef.current.length > 32) rippleRef.current.shift()
      }

      mouseState.last = { ...currentMouse }
      mouseState.lastMs = nowMs

      ctx.globalCompositeOperation = 'lighter'

      const ringCount = Math.ceil(maxR / ringGap) + 2
      const segments = clamp(Math.round(minDim * 0.42), 96, 168)

      const drawWavyRing = (
        center: Point,
        radius: number,
        alpha: number,
        widthPx: number,
        colorA: string,
        colorB: string
      ) => {
        ctx.save()
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'

        ctx.shadowBlur = 34
        ctx.shadowColor = colorA
        ctx.strokeStyle = colorA
        ctx.globalAlpha = alpha
        ctx.lineWidth = widthPx

        ctx.beginPath()
        for (let i = 0; i <= segments; i++) {
          const a = (i / segments) * Math.PI * 2

          const wave =
            Math.sin(a * 7 + t * 1.35) * 0.012 +
            Math.sin(a * 15 - t * 1.15) * 0.009 +
            Math.sin(a * 33 + t * 0.65) * 0.006

          const bulge =
            Math.exp(-(angleDiff(a, mouseAngle) ** 2) / (2 * 0.55 ** 2)) *
            (0.025 + 0.065 * mouseState.energy) *
            (0.35 + 0.65 * (1 - mouseDistNorm))

          const rr = radius * (1 + wave + bulge)
          const x = center.x + Math.cos(a) * rr
          const y = center.y + Math.sin(a) * rr

          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.stroke()

        ctx.shadowBlur = 10
        ctx.shadowColor = colorB
        ctx.globalAlpha = alpha * 0.78
        ctx.lineWidth = Math.max(1, widthPx * 0.35)
        ctx.strokeStyle = colorB
        ctx.stroke()

        ctx.restore()
      }

      for (let i = 0; i < ringCount; i++) {
        const r = i * ringGap + offset
        if (r > maxR) continue

        const radiusNorm = r / maxR
        const fade = (1 - radiusNorm) ** 1.65
        const wobble = 0.65 + 0.35 * Math.sin(t * 1.1 - r * 0.015)
        const alpha = clamp(0.28 * fade * wobble, 0.04, 0.36)
        const widthPx = clamp(2.8 + 6.6 * (1 - radiusNorm), 2, 9)

        drawWavyRing(
          { x: cx, y: cy },
          r,
          alpha,
          widthPx,
          'rgba(167, 139, 250, 1)',
          'rgba(14, 165, 233, 0.85)'
        )
      }

      const ripples = rippleRef.current
      if (ripples.length) {
        const rippleSpeed = minDim * 0.65
        const lifetime = 1.8
        for (let i = ripples.length - 1; i >= 0; i--) {
          const ripple = ripples[i]
          const age = (nowMs - ripple.startMs) * 0.001
          if (age > lifetime) {
            ripples.splice(i, 1)
            continue
          }

          const p = age / lifetime
          const r = p * rippleSpeed
          const fade = 1 - smoothstep(0.15, 1, p)
          const alpha = clamp(ripple.strength * 0.34 * fade, 0.05, 0.42)
          const widthPx = clamp(1.8 + 3.8 * (1 - p), 1.4, 5.4)

          drawWavyRing(
            ripple.origin,
            r,
            alpha,
            widthPx,
            'rgba(16, 185, 129, 0.9)',
            'rgba(167, 139, 250, 0.65)'
          )
        }
      }

      const vignette = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 1.05)
      vignette.addColorStop(0.5, 'rgba(0, 0, 0, 0)')
      vignette.addColorStop(0.82, 'rgba(0, 0, 0, 0.5)')
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.82)')
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, width, height)

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [mouse])

  return <canvas ref={canvasRef} className={className} />
}
