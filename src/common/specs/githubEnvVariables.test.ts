import { describe, expect, test } from 'bun:test'
import { getGitHubEnvVariables, withGitHubEnvVariables } from '../../config'

describe('withGitHubEnvVariables', () => {
  test('returns scoped env variables without mutating process.env', async () => {
    const before = {
      GITHUB_SHA: process.env.GITHUB_SHA,
      BASE_SHA: process.env.BASE_SHA,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    }

    const result = await withGitHubEnvVariables(
      { githubSha: 'head', baseSha: 'base', githubToken: '' },
      async () => getGitHubEnvVariables()
    )

    expect(result).toEqual({ githubSha: 'head', baseSha: 'base', githubToken: '' })
    expect(process.env.GITHUB_SHA).toBe(before.GITHUB_SHA)
    expect(process.env.BASE_SHA).toBe(before.BASE_SHA)
    expect(process.env.GITHUB_TOKEN).toBe(before.GITHUB_TOKEN)
  })
})
