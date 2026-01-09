import { describe, expect, test } from 'bun:test'
import {
  fetchGitHubPullRequestDetails,
  fetchGitHubPullRequestDiff,
} from '../pullRequestApi'

const buildOkResponse = () =>
  new Response(
    JSON.stringify({
      html_url: 'https://github.com/example/repo/pull/1',
      base: {
        sha: 'base-sha',
        repo: {
          clone_url: 'https://github.com/example/repo.git',
          ssh_url: 'git@github.com:example/repo.git',
        },
      },
      head: { sha: 'head-sha' },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )

describe('fetchGitHubPullRequestDetails', () => {
  test('builds GitHub API request and returns metadata', async () => {
    const originalFetch = globalThis.fetch
    let requestedUrl = ''
    let requestedAuth: string | undefined

    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      requestedAuth = headers?.authorization
      return buildOkResponse()
    }

    try {
      const result = await fetchGitHubPullRequestDetails({
        pullRequest: { owner: 'example', repo: 'repo', number: 1 },
        token: 'token123',
      })
      expect(requestedUrl).toContain('https://api.github.com/repos/example/repo/pulls/1')
      expect(requestedAuth).toBe('Bearer token123')
      expect(result).toEqual({
        htmlUrl: 'https://github.com/example/repo/pull/1',
        baseSha: 'base-sha',
        headSha: 'head-sha',
        cloneUrl: 'https://github.com/example/repo.git',
        sshUrl: 'git@github.com:example/repo.git',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('throws when response is not ok', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('Forbidden', { status: 403 })

    try {
      await expect(
        fetchGitHubPullRequestDetails({
          pullRequest: { owner: 'example', repo: 'repo', number: 1 },
        })
      ).rejects.toThrow('GitHub API request failed')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('fetchGitHubPullRequestDiff', () => {
  test('builds GitHub API request and returns diff text', async () => {
    const originalFetch = globalThis.fetch
    let requestedUrl = ''
    let requestedAccept: string | undefined
    let requestedAuth: string | undefined

    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input)
      const headers = init?.headers as Record<string, string> | undefined
      requestedAccept = headers?.accept
      requestedAuth = headers?.authorization
      return new Response('diff --git a/file.txt b/file.txt\n', { status: 200 })
    }

    try {
      const result = await fetchGitHubPullRequestDiff({
        pullRequest: { owner: 'example', repo: 'repo', number: 2 },
        token: 'token123',
      })
      expect(requestedUrl).toContain('https://api.github.com/repos/example/repo/pulls/2')
      expect(requestedAccept).toBe('application/vnd.github.v3.diff')
      expect(requestedAuth).toBe('Bearer token123')
      expect(result).toContain('diff --git')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('throws when response is not ok', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('Not found', { status: 404 })

    try {
      await expect(
        fetchGitHubPullRequestDiff({
          pullRequest: { owner: 'example', repo: 'repo', number: 2 },
        })
      ).rejects.toThrow('GitHub API diff request failed')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
