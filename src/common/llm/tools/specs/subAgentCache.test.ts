import { describe, expect, test } from 'bun:test'
import { tool } from 'ai'
import { z } from 'zod'
import { createCachedSubAgentTool } from '../subAgentCache'

describe('createCachedSubAgentTool', () => {
  test('returns cached report on exact goal match', async () => {
    let executed = 0
    const baseTool = tool({
      description: 'Spawn a sub-agent.',
      parameters: z.object({ goal: z.string() }),
      execute: async ({ goal }: { goal: string }) => {
        executed += 1
        return `base:${goal}`
      },
    })

    const cache = new Map<string, string>([['[Static Analysis Agent] foo', 'cached']])
    const cachedTool = createCachedSubAgentTool(baseTool, cache)

    const result = await cachedTool.execute?.({ goal: '[Static Analysis Agent] foo' }, {})

    expect(result).toBe('cached')
    expect(executed).toBe(0)
  })

  test('matches cached report by [Role] prefix even with leading numbering/bullets', async () => {
    let executed = 0
    const baseTool = tool({
      description: 'Spawn a sub-agent.',
      parameters: z.object({ goal: z.string() }),
      execute: async ({ goal }: { goal: string }) => {
        executed += 1
        return `base:${goal}`
      },
    })

    const cache = new Map<string, string>([
      ['1) [Static Analysis Agent] Scan changed code.', 'cached-static'],
      ['- [Security Analysis Agent] Look for security issues.', 'cached-security'],
    ])
    const cachedTool = createCachedSubAgentTool(baseTool, cache)

    const staticResult = await cachedTool.execute?.(
      { goal: '[Static Analysis Agent] Anything else.' },
      {}
    )
    const securityResult = await cachedTool.execute?.(
      { goal: '[Security Analysis Agent] Different goal.' },
      {}
    )

    expect(staticResult).toBe('cached-static')
    expect(securityResult).toBe('cached-security')
    expect(executed).toBe(0)
  })

  test('falls back to base tool and caches returned report', async () => {
    let executed = 0
    const baseTool = tool({
      description: 'Spawn a sub-agent.',
      parameters: z.object({ goal: z.string() }),
      execute: async ({ goal }: { goal: string }) => {
        executed += 1
        return `base:${goal}`
      },
    })

    const cache = new Map<string, string>()
    const cachedTool = createCachedSubAgentTool(baseTool, cache)

    const result = await cachedTool.execute?.({ goal: '[Logic Analysis Agent] foo' }, {})

    expect(result).toBe('base:[Logic Analysis Agent] foo')
    expect(executed).toBe(1)
    expect(cache.get('[Logic Analysis Agent] foo')).toBe(
      'base:[Logic Analysis Agent] foo'
    )
  })
})
