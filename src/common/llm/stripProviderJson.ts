const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isProviderToolCallsChunk = (value: unknown): boolean => {
  if (!isRecord(value)) return false

  if (Array.isArray(value.choices)) {
    return value.choices.some((choice) => isProviderToolCallsChunk(choice))
  }

  const delta = value.delta
  if (!isRecord(delta)) return false
  return Array.isArray(delta.tool_calls)
}

const extractJsonSpan = (
  text: string,
  startIndex: number
): { endIndex: number; json: string } | null => {
  const startChar = text[startIndex]
  if (startChar !== '{' && startChar !== '[') return null

  const stack: Array<'}' | ']'> = [startChar === '{' ? '}' : ']']
  let inString = false
  let escaped = false

  for (let i = startIndex + 1; i < text.length; i += 1) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      stack.push('}')
      continue
    }
    if (ch === '[') {
      stack.push(']')
      continue
    }

    if (ch === '}' || ch === ']') {
      const expected = stack.pop()
      if (!expected || ch !== expected) return null
      if (stack.length === 0) {
        return {
          endIndex: i + 1,
          json: text.slice(startIndex, i + 1),
        }
      }
    }
  }

  return null
}

export const stripProviderJsonFromText = (text: string): string => {
  let cleanText = ''
  let i = 0

  while (i < text.length) {
    if (text[i] === '{' || text[i] === '[') {
      const span = extractJsonSpan(text, i)
      if (span) {
        try {
          const parsed = JSON.parse(span.json) as unknown
          if (isProviderToolCallsChunk(parsed)) {
            i = span.endIndex
            continue
          }
        } catch {
          // ignore parse failures and treat as text
        }
      }
    }

    cleanText += text[i]
    i++
  }

  return cleanText.replace(/\n{3,}/g, '\n\n').trim()
}
