import type { MutableRefObject } from 'react'
import { useEffect, useRef } from 'react'

export type RenderQuality = 1 | 0.75 | 0.5
export type MouseRef = MutableRefObject<{ x: number; y: number }>

interface GlyphDitherCanvasProps {
  className?: string
  mouse: MouseRef
  renderQuality?: RenderQuality
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

const hash2 = (x: number, y: number) =>
  fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123)

const noise2 = (x: number, y: number) => {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi

  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)

  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)

  return lerp(lerp(a, b, u), lerp(c, d, u), v)
}

const fbm2 = (x: number, y: number) => {
  let value = 0
  let amplitude = 0.55
  let frequency = 1
  for (let i = 0; i < 4; i++) {
    value += amplitude * noise2(x * frequency, y * frequency)
    frequency *= 2
    amplitude *= 0.5
  }
  return value
}

type Viewport = {
  width: number
  height: number
  scale: number
}

type CausticsParams = {
  circleCenterX: number
  circleCenterY: number
  ringRadius: number
  ringThickness: number
}

const gradientMap = (t: number) => {
  const tt = clamp(t, 0, 1)
  const c0 = [8, 10, 16]
  const c1 = [14, 165, 233]
  const c2 = [167, 139, 250]
  const c3 = [224, 231, 255]

  if (tt < 0.55) {
    const k = smoothstep(0.08, 0.55, tt)
    return [lerp(c0[0], c1[0], k), lerp(c0[1], c1[1], k), lerp(c0[2], c1[2], k)]
  }
  if (tt < 0.82) {
    const k = smoothstep(0.55, 0.82, tt)
    return [lerp(c1[0], c2[0], k), lerp(c1[1], c2[1], k), lerp(c1[2], c2[2], k)]
  }
  const k = smoothstep(0.82, 1, tt)
  return [lerp(c2[0], c3[0], k), lerp(c2[1], c3[1], k), lerp(c2[2], c3[2], k)]
}

const computeEnergy = (
  x: number,
  y: number,
  nowS: number,
  viewport: Viewport,
  mouse: { x: number; y: number },
  params: CausticsParams
) => {
  const { width, height } = viewport
  if (!width || !height) return 0

  const sx = x / width
  const sy = y / height

  const cx = params.circleCenterX
  const cy = params.circleCenterY

  const minDim = Math.min(width, height)
  if (!minDim) return 0
  const px = (x - cx) / minDim
  const py = (y - cy) / minDim
  const dist = Math.hypot(px, py)

  const ringRadius = params.ringRadius / minDim
  const ringThickness = params.ringThickness / minDim
  if (
    !Number.isFinite(ringRadius) ||
    !Number.isFinite(ringThickness) ||
    ringThickness <= 0
  ) {
    return 0
  }

  const ringBand =
    1 - smoothstep(ringThickness, ringThickness * 1.7, Math.abs(dist - ringRadius))
  const outside = smoothstep(0, ringThickness * 0.6, dist - ringRadius)
  const ringMask = clamp(ringBand * outside, 0, 1)

  const edgeDist = Math.min(sx, sy, 1 - sx, 1 - sy)
  // Keep edge glyphs as a thin "frame" like the reference.
  const edgeMask = 1 - smoothstep(0.01, 0.045, edgeDist)

  const baseMask = clamp(Math.max(ringMask * 1.05, edgeMask * 0.75), 0, 1)
  if (!Number.isFinite(baseMask) || baseMask < 0.01) {
    return 0
  }

  // Domain warp (low-frequency)
  const ux = px * 1.25
  const uy = py * 1.25

  const warpX = fbm2(ux * 1.4 + nowS * 0.11, uy * 1.4 - nowS * 0.09) - 0.5
  const warpY = fbm2(ux * 1.4 - nowS * 0.08, uy * 1.4 + nowS * 0.1) - 0.5

  const wx = ux + warpX * 0.22
  const wy = uy + warpY * 0.22

  // Caustics filaments
  const flow = fbm2(wx * 5.1 + nowS * 0.35, wy * 5.1 - nowS * 0.32)
  const stripeA = Math.abs(Math.sin((flow * 15 + nowS * 1.2) * Math.PI))

  const flow2 = fbm2(wx * 9.2 - nowS * 0.6, wy * 9.2 + nowS * 0.55)
  const stripeB = Math.abs(Math.sin((flow2 * 11.5 - nowS * 1.05) * Math.PI))

  const filament = Math.max(stripeA ** 6, stripeB ** 5)
  const caustics = clamp(0.18 + filament * 0.95, 0, 1)

  // Mouse influence (subtle, localized)
  const mx = (mouse.x * width - cx) / minDim
  const my = (mouse.y * height - cy) / minDim
  const md = Math.hypot(px - mx, py - my)
  const mouseGlow = Math.exp(-(md ** 2) / (2 * 0.16 ** 2)) * 0.25

  const energy = clamp(baseMask * caustics + mouseGlow * baseMask, 0, 1)
  return Number.isFinite(energy) ? energy : 0
}

export function GlyphDitherCanvas({
  className,
  mouse,
  renderQuality = 1,
}: GlyphDitherCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const rafRef = useRef<number | null>(null)
  const frameRef = useRef(0)

  const viewportRef = useRef<Viewport>({
    width: 0,
    height: 0,
    scale: 1,
  })

  const fieldCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const fieldCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const fieldImageRef = useRef<ImageData | null>(null)

  const glyphCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const glyphCtxRef = useRef<CanvasRenderingContext2D | null>(null)

  const paramsRef = useRef<CausticsParams>({
    circleCenterX: 0,
    circleCenterY: 0,
    ringRadius: 0,
    ringThickness: 0,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx =
      canvas.getContext('2d', { alpha: true, desynchronized: true }) ??
      canvas.getContext('2d')
    if (!ctx) return

    ctxRef.current = ctx

    const fieldCanvas = document.createElement('canvas')
    const fieldCtx = fieldCanvas.getContext('2d')
    fieldCanvasRef.current = fieldCanvas
    fieldCtxRef.current = fieldCtx

    const glyphCanvas = document.createElement('canvas')
    const glyphCtx = glyphCanvas.getContext('2d')
    glyphCanvasRef.current = glyphCanvas
    glyphCtxRef.current = glyphCtx

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

      canvas.width = nextWidth
      canvas.height = nextHeight

      glyphCanvas.width = nextWidth
      glyphCanvas.height = nextHeight

      viewportRef.current = {
        width: cssWidth,
        height: cssHeight,
        scale,
      }

      // Circle parameters tuned to match the reference: large circle, slightly lower center.
      const params = paramsRef.current
      const minDim = Math.min(cssWidth, cssHeight)
      params.circleCenterX = cssWidth * 0.5
      params.circleCenterY = cssHeight * 0.56
      params.ringRadius = minDim * 0.54
      params.ringThickness = minDim * 0.17

      // Field buffer (low-res)
      const targetPixels = 48000
      const fieldScale = clamp(
        Math.sqrt(targetPixels / Math.max(1, cssWidth * cssHeight)),
        0.12,
        0.22
      )
      const fw = Math.max(2, Math.floor(cssWidth * fieldScale))
      const fh = Math.max(2, Math.floor(cssHeight * fieldScale))
      fieldCanvas.width = fw
      fieldCanvas.height = fh
      if (fieldCtx) {
        fieldImageRef.current = fieldCtx.createImageData(fw, fh)
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
    const fieldCtx = fieldCtxRef.current
    const fieldCanvas = fieldCanvasRef.current
    const glyphCtx = glyphCtxRef.current
    const glyphCanvas = glyphCanvasRef.current

    if (!ctx || !canvas || !fieldCtx || !fieldCanvas || !glyphCtx || !glyphCanvas) return

    const glyphs = [' ', 'c', 'C', '0', 'O', 'S', 'T']
    const fontStack =
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

    const draw = (nowMs: number) => {
      const viewport = viewportRef.current
      if (!viewport.width || !viewport.height) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      const { width, height, scale } = viewport
      const nowS = nowMs * 0.001
      frameRef.current += 1
      const params = paramsRef.current

      // Background base
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.fillStyle = '#05060a'
      ctx.fillRect(0, 0, width, height)

      // Field layer (procedural caustics glow) updated at ~30fps.
      const fieldImage = fieldImageRef.current
      if (fieldImage && frameRef.current % 2 === 0) {
        const fw = fieldCanvas.width
        const fh = fieldCanvas.height
        const data = fieldImage.data

        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            const fx = (x + 0.5) * (width / fw)
            const fy = (y + 0.5) * (height / fh)
            const e = computeEnergy(fx, fy, nowS, viewport, mouse.current, params)

            const i = (y * fw + x) * 4
            if (e <= 0.001) {
              data[i] = 0
              data[i + 1] = 0
              data[i + 2] = 0
              data[i + 3] = 0
              continue
            }

            const [r, g, b] = gradientMap(e)
            const a = clamp(e ** 1.5 * 220, 0, 230)
            data[i] = r
            data[i + 1] = g
            data[i + 2] = b
            data[i + 3] = a
          }
        }

        fieldCtx.putImageData(fieldImage, 0, 0)
      }

      ctx.globalCompositeOperation = 'lighter'
      ctx.imageSmoothingEnabled = true
      ctx.filter = 'blur(18px)'
      ctx.globalAlpha = 0.95
      ctx.drawImage(fieldCanvas, 0, 0, width, height)
      ctx.filter = 'blur(6px)'
      ctx.globalAlpha = 0.55
      ctx.drawImage(fieldCanvas, 0, 0, width, height)
      ctx.filter = 'none'

      // Glyph layer
      glyphCtx.setTransform(scale, 0, 0, scale, 0, 0)
      glyphCtx.clearRect(0, 0, width, height)
      glyphCtx.textAlign = 'center'
      glyphCtx.textBaseline = 'middle'

      const cellSize = clamp(Math.round(Math.min(width, height) / 64), 10, 14)
      glyphCtx.font = `${cellSize}px ${fontStack}`

      const cols = Math.ceil(width / cellSize) + 1
      const rows = Math.ceil(height / cellSize) + 1

      for (let row = 0; row < rows; row++) {
        const y = row * cellSize + cellSize * 0.5
        if (y < 0 || y > height) continue

        for (let col = 0; col < cols; col++) {
          const x = col * cellSize + cellSize * 0.5
          if (x < 0 || x > width) continue

          let e = computeEnergy(x, y, nowS, viewport, mouse.current, params)

          const isBorder = row === 0 || col === 0 || row === rows - 1 || col === cols - 1
          if (isBorder) {
            const shimmer = 0.7 + 0.25 * Math.sin(nowS * 0.55 + (col + row) * 0.12)
            e = Math.max(e, shimmer)
          }

          if (e < 0.11) continue

          const jitter = hash2(col * 3.1, row * 2.7)
          const density = clamp(e + (jitter - 0.5) * 0.08, 0, 1)

          const glyphIndex =
            density > 0.88
              ? 2
              : density > 0.74
                ? 3
                : density > 0.62
                  ? 5
                  : density > 0.48
                    ? 6
                    : density > 0.34
                      ? 1
                      : 0

          const onTop = row === 0
          const onBottom = row === rows - 1
          const onLeft = col === 0
          const onRight = col === cols - 1

          const glyph = isBorder
            ? onTop || onLeft
              ? 'S'
              : onBottom || onRight
                ? 'C'
                : 'C'
            : (glyphs[glyphIndex] ?? 'C')

          const [r, g, b] = gradientMap(density)
          const alpha = clamp((density - 0.08) * 1.25, 0.08, 0.9)

          glyphCtx.fillStyle = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(
            b
          )}, ${alpha})`
          glyphCtx.fillText(glyph, x, y)
        }
      }

      // Composite glyph layer with bloom-ish blur
      ctx.globalCompositeOperation = 'lighter'
      ctx.filter = 'blur(9px)'
      ctx.globalAlpha = 0.92
      ctx.drawImage(glyphCanvas, 0, 0, width, height)
      ctx.filter = 'none'
      ctx.globalAlpha = 1
      ctx.drawImage(glyphCanvas, 0, 0, width, height)

      // Deep black inner mask (keeps center clean like the reference)
      const minDim = Math.min(width, height)
      const innerRadius = params.ringRadius - params.ringThickness * 0.55
      const mask = ctx.createRadialGradient(
        params.circleCenterX,
        params.circleCenterY,
        Math.max(0, innerRadius - minDim * 0.08),
        params.circleCenterX,
        params.circleCenterY,
        Math.max(1, innerRadius + minDim * 0.06)
      )
      mask.addColorStop(0, 'rgba(0, 0, 0, 0.96)')
      mask.addColorStop(0.62, 'rgba(0, 0, 0, 0.96)')
      mask.addColorStop(1, 'rgba(0, 0, 0, 0)')

      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.fillStyle = mask
      ctx.fillRect(0, 0, width, height)

      // Outer vignette
      const outer = ctx.createRadialGradient(
        width * 0.5,
        height * 0.52,
        minDim * 0.25,
        width * 0.5,
        height * 0.52,
        minDim * 0.92
      )
      outer.addColorStop(0, 'rgba(0, 0, 0, 0)')
      outer.addColorStop(0.75, 'rgba(0, 0, 0, 0.42)')
      outer.addColorStop(1, 'rgba(0, 0, 0, 0.78)')
      ctx.fillStyle = outer
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
