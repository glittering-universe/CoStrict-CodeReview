type RetryingFetcherOptions = {
  maxRetries?: number
  baseDelayMs?: number
}

const retryableStatusCodes = new Set([408, 425, 429, 500, 502, 503, 504])

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const shouldRetryStatus = (status: number) => retryableStatusCodes.has(status)

const parseRetryAfterMs = (headerValue: string | null): number | undefined => {
  if (!headerValue) return undefined

  const seconds = Number.parseInt(headerValue, 10)
  if (!Number.isNaN(seconds)) {
    return seconds * 1000
  }

  const dateMs = Date.parse(headerValue)
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now()
    return delta > 0 ? delta : undefined
  }

  return undefined
}

const isNonRetryable429Response = (responseBodyText: string): boolean => {
  const trimmed = responseBodyText.trim()
  if (!trimmed) return false

  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { code?: unknown; message?: unknown }
      message?: unknown
    }
    const code = parsed?.error?.code
    if (code === '1113' || code === 1113) {
      // BigModel: insufficient balance/no resource package
      return true
    }
    const message =
      typeof parsed?.error?.message === 'string'
        ? parsed.error.message
        : typeof parsed?.message === 'string'
          ? parsed.message
          : ''
    if (message) {
      return (
        message.includes('余额不足') ||
        message.includes('无可用资源包') ||
        message.toLowerCase().includes('insufficient') ||
        message.toLowerCase().includes('quota') ||
        message.toLowerCase().includes('payment required')
      )
    }
  } catch {
    // fall through to best-effort string matching
  }

  return (
    trimmed.includes('余额不足') ||
    trimmed.includes('无可用资源包') ||
    trimmed.toLowerCase().includes('insufficient') ||
    trimmed.toLowerCase().includes('quota') ||
    trimmed.toLowerCase().includes('payment required')
  )
}

const isAbortError = (error: unknown) => {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      // bun/undici error codes
      // biome-ignore lint/suspicious/noExplicitAny: runtime error typing
      (error as any).code === 'ABORT_ERR')
  )
}

const shouldRetryError = (error: unknown) => {
  if (!(error instanceof Error)) return false
  if (isAbortError(error)) return false

  const message = error.message.toLowerCase()
  // bun/undici/network style errors
  const codeValue = (error as Error & { code?: unknown }).code
  const code = typeof codeValue === 'string' ? codeValue.toLowerCase() : ''

  return (
    message.includes('network error') ||
    message.includes('fetch failed') ||
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('econnrefused') ||
    message.includes('timeout') ||
    code === 'econnreset' ||
    code === 'etimedout' ||
    code === 'econnrefused' ||
    code === 'und_err_connect_timeout'
  )
}

/**
 * Wraps fetch with simple exponential backoff for transient network/API failures.
 * Designed to be used with LLM providers to reduce flaky "network error" failures.
 */
const getEnvNumber = (key: string): number | undefined => {
  const raw = process.env[key]
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

export const createRetryingFetcher = ({
  maxRetries = getEnvNumber('SHIPPIE_FETCH_MAX_RETRIES') ?? 5,
  baseDelayMs = getEnvNumber('SHIPPIE_FETCH_BASE_DELAY_MS') ?? 1000,
}: RetryingFetcherOptions = {}): typeof fetch => {
  let cooldownUntilMs = 0

  // Use a standalone function so we can attach Bun-specific helpers for type compatibility.
  const wrappedFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ): ReturnType<typeof fetch> => {
    let attempt = 0
    let delay = baseDelayMs
    let lastError: unknown

    while (attempt <= maxRetries) {
      try {
        const now = Date.now()
        if (now < cooldownUntilMs) {
          await sleep(cooldownUntilMs - now)
        }

        const response = await fetch(input, init)

        if (!response.ok && shouldRetryStatus(response.status) && attempt < maxRetries) {
          if (response.status === 429) {
            try {
              const bodyText = await response.clone().text()
              if (isNonRetryable429Response(bodyText)) {
                // Avoid provider-level retries by mapping non-retryable 429s (e.g. insufficient balance)
                // to a non-retryable HTTP status.
                const headers = new Headers(response.headers)
                if (!headers.has('content-type')) {
                  headers.set('content-type', 'application/json')
                }
                headers.set('x-shippie-original-status', '429')
                return new Response(bodyText, {
                  status: 402,
                  statusText: 'Payment Required',
                  headers,
                })
              }
            } catch {
              // ignore inspection failures and fall through to retry logic
            }
          }

          // Consume body to free connection before retrying
          try {
            await response.arrayBuffer()
          } catch {
            // ignore drain failure
          }

          const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
          const statusBaseDelayMs =
            response.status === 429 ? Math.max(delay, 5000) : delay
          const jitter = Math.floor(Math.random() * 250)
          const waitMs = Math.min(
            retryAfterMs ?? statusBaseDelayMs + jitter,
            getEnvNumber('SHIPPIE_FETCH_MAX_BACKOFF_MS') ?? 120_000
          )

          if (response.status === 429) {
            cooldownUntilMs = Math.max(cooldownUntilMs, Date.now() + waitMs)
          }

          await sleep(waitMs)
          delay *= 2
          attempt++
          continue
        }

        return response
      } catch (error) {
        lastError = error
        if (attempt >= maxRetries || !shouldRetryError(error) || init?.signal?.aborted) {
          throw error
        }
        const jitter = Math.floor(Math.random() * 250)
        const waitMs = Math.min(
          delay + jitter,
          getEnvNumber('SHIPPIE_FETCH_MAX_BACKOFF_MS') ?? 120_000
        )
        await sleep(waitMs)
        delay *= 2
        attempt++
      }
    }

    // Should not reach here; throw the last seen error as a safeguard
    throw lastError instanceof Error
      ? lastError
      : new Error('Retrying fetch failed with unknown error')
  }

  // Preserve optional Bun helpers when available to satisfy typeof fetch typing.
  const baseFetch = globalThis.fetch as unknown as Record<string, unknown>
  const wrappedFetchAsRecord = wrappedFetch as unknown as Record<string, unknown>
  for (const helper of ['preconnect', 'websocket', 'webSocket']) {
    if (typeof baseFetch[helper] === 'function') {
      wrappedFetchAsRecord[helper] = baseFetch[helper]
    }
  }

  return wrappedFetch as typeof fetch
}
