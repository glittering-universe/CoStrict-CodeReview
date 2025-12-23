import { describe, expect, test } from 'bun:test'
import { createRetryingFetcher } from '../fetchWithRetry'

describe('createRetryingFetcher', () => {
  test('maps non-retryable 429 to 402 and does not retry', async () => {
    let hits = 0
    const originalFetch = globalThis.fetch

    globalThis.fetch = (async () => {
      hits += 1
      return new Response(
        JSON.stringify({
          error: { code: '1113', message: '余额不足或无可用资源包,请充值。' },
        }),
        {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }
      )
    }) as typeof fetch

    try {
      const wrappedFetch = createRetryingFetcher({ maxRetries: 3, baseDelayMs: 1 })
      const response = await wrappedFetch('https://example.com/')

      expect(hits).toBe(1)
      expect(response.status).toBe(402)
      expect(response.headers.get('x-shippie-original-status')).toBe('429')

      const bodyText = await response.text()
      expect(bodyText).toContain('1113')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
