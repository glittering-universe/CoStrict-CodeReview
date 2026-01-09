const MAX_CONTEXT_CHARS = 1500
const MAX_BULLETS_PER_SECTION = 3

const stripToolCallArtifacts = (input: string): string => {
  return input
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (trimmed.startsWith('<tool_call')) return false
      if (trimmed.startsWith('</tool_call')) return false
      if (trimmed.startsWith('<function=')) return false
      if (trimmed.startsWith('<parameter=')) return false
      return true
    })
    .join('\n')
}

const truncateWithTailPreference = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value
  const headChars = Math.max(0, Math.floor(maxChars * 0.7))
  const tailChars = Math.max(0, maxChars - headChars)
  const head = value.slice(0, headChars).trimEnd()
  const tail = value.slice(-tailChars).trimStart()
  return `${head}\n\n... [truncated: ${value.length} chars total] ...\n\n${tail}`
}

const findSectionRange = (
  lines: string[],
  headerMatcher: (line: string) => boolean
): { start: number; end: number } | null => {
  const startIndex = lines.findIndex(headerMatcher)
  if (startIndex === -1) return null

  let endIndex = lines.length
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (/^\s*#{1,6}\s+/.test(lines[i])) {
      endIndex = i
      break
    }
  }

  return { start: startIndex + 1, end: endIndex }
}

const extractBullets = (lines: string[], maxBullets: number): string[] => {
  const bullets: string[] = []

  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (!match?.[1]) continue
    const value = match[1].trim()
    if (!value) continue
    bullets.push(value)
    if (bullets.length >= maxBullets) break
  }

  return bullets
}

const extractNonEmptyLines = (lines: string[], maxLines: number): string[] => {
  const values: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    values.push(trimmed)
    if (values.length >= maxLines) break
  }
  return values
}

export const summarizeSubAgentReportForContext = (report: string): string => {
  const cleaned = stripToolCallArtifacts(report).trim()
  if (!cleaned) return ''

  const lines = cleaned.split(/\r?\n/)

  const findingsRange = findSectionRange(lines, (line) =>
    /^\s*#{2,6}\s*findings\b/i.test(line)
  )
  const recommendationsRange = findSectionRange(lines, (line) =>
    /^\s*#{2,6}\s*recommendations?\b/i.test(line)
  )

  const findingsLines = findingsRange
    ? lines.slice(findingsRange.start, findingsRange.end)
    : []
  const recommendationLines = recommendationsRange
    ? lines.slice(recommendationsRange.start, recommendationsRange.end)
    : []

  const findings = extractBullets(findingsLines, MAX_BULLETS_PER_SECTION)
  const recommendations = extractBullets(recommendationLines, MAX_BULLETS_PER_SECTION)

  const blocks: string[] = []

  if (findings.length > 0) {
    blocks.push(`Key findings:\n${findings.map((item) => `- ${item}`).join('\n')}`)
  }
  if (recommendations.length > 0) {
    blocks.push(
      `Key recommendations:\n${recommendations.map((item) => `- ${item}`).join('\n')}`
    )
  }

  if (blocks.length === 0) {
    const fallback = extractNonEmptyLines(lines, 10)
    blocks.push(fallback.join('\n'))
  }

  return truncateWithTailPreference(blocks.join('\n\n'), MAX_CONTEXT_CHARS)
}
