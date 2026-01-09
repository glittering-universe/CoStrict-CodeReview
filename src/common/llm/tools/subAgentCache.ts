import { type Tool, tool } from 'ai'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const extractSubAgentGoalPrefix = (goal: string): string | null => {
  const match = goal.match(/\[[^\]]+\]/)
  return match?.[0] ?? null
}

export const createCachedSubAgentTool = (
  baseTool: Tool,
  cache: Map<string, string>
): Tool =>
  tool({
    description: `${baseTool.description ?? 'Spawn a sub-agent.'} (cached)`,
    parameters: baseTool.parameters,
    execute: async (args, options) => {
      const parsed = isRecord(args) ? args : {}
      const goal = typeof parsed.goal === 'string' ? parsed.goal : ''

      if (goal) {
        const exact = cache.get(goal)
        if (exact !== undefined) return exact

        const requestedPrefix = extractSubAgentGoalPrefix(goal)
        if (requestedPrefix) {
          const cachedGoal = Array.from(cache.keys()).find((key) => {
            const cachedPrefix = extractSubAgentGoalPrefix(key)
            return cachedPrefix === requestedPrefix
          })
          if (cachedGoal) {
            return cache.get(cachedGoal) ?? ''
          }
        }
      }

      if (!baseTool.execute) {
        return 'spawn_subagent unavailable for this run.'
      }

      const result = await baseTool.execute(args as never, options)
      if (goal && typeof result === 'string') {
        cache.set(goal, result)
      }
      return result
    },
  })
