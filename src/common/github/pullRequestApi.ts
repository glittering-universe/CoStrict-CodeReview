import { logger } from '../utils/logger'
import type { GitHubPullRequestRef } from './pullRequest'

type GitHubPullRequestApiResponse = {
  html_url?: unknown
  base?: {
    sha?: unknown
    repo?: {
      clone_url?: unknown
      ssh_url?: unknown
    }
  }
  head?: {
    sha?: unknown
  }
}

export type GitHubPullRequestDetails = {
  htmlUrl: string
  baseSha: string
  headSha: string
  cloneUrl: string
  sshUrl: string
}

const resolveGitHubApiBaseUrl = (): string => {
  const raw = process.env.COSTRICT_GITHUB_API_BASE_URL
  const trimmed = raw?.trim().replace(/\/$/, '')
  return trimmed || 'https://api.github.com'
}

export const fetchGitHubPullRequestDiff = async ({
  pullRequest,
  token,
}: {
  pullRequest: GitHubPullRequestRef
  token?: string
}): Promise<string> => {
  const apiBaseUrl = resolveGitHubApiBaseUrl()
  const url = `${apiBaseUrl}/repos/${pullRequest.owner}/${pullRequest.repo}/pulls/${pullRequest.number}`

  const headers: Record<string, string> = {
    accept: 'application/vnd.github.v3.diff',
    'user-agent': 'costrict-web',
  }

  const trimmedToken = token?.trim()
  if (trimmedToken) {
    headers.authorization = `Bearer ${trimmedToken}`
  }

  logger.info(
    `Fetching GitHub PR diff: ${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`
  )
  const response = await fetch(url, { headers })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const snippet = body.trim().slice(0, 500)
    throw new Error(
      `GitHub API diff request failed (${response.status})${snippet ? `: ${snippet}` : ''}`
    )
  }

  return response.text()
}

export const fetchGitHubPullRequestDetails = async ({
  pullRequest,
  token,
}: {
  pullRequest: GitHubPullRequestRef
  token?: string
}): Promise<GitHubPullRequestDetails> => {
  const apiBaseUrl = resolveGitHubApiBaseUrl()
  const url = `${apiBaseUrl}/repos/${pullRequest.owner}/${pullRequest.repo}/pulls/${pullRequest.number}`

  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'costrict-web',
  }

  const trimmedToken = token?.trim()
  if (trimmedToken) {
    headers.authorization = `Bearer ${trimmedToken}`
  }

  logger.info(
    `Fetching GitHub PR metadata: ${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`
  )
  const response = await fetch(url, { headers })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const snippet = body.trim().slice(0, 500)
    throw new Error(
      `GitHub API request failed (${response.status})${snippet ? `: ${snippet}` : ''}`
    )
  }

  const data = (await response.json()) as GitHubPullRequestApiResponse

  const htmlUrl = typeof data.html_url === 'string' ? data.html_url : ''
  const baseSha = typeof data.base?.sha === 'string' ? data.base.sha : ''
  const headSha = typeof data.head?.sha === 'string' ? data.head.sha : ''
  const cloneUrl =
    typeof data.base?.repo?.clone_url === 'string' ? data.base.repo.clone_url : ''
  const sshUrl =
    typeof data.base?.repo?.ssh_url === 'string' ? data.base.repo.ssh_url : ''

  if (!htmlUrl || !baseSha || !headSha || !cloneUrl) {
    throw new Error('GitHub API response missing expected pull request metadata.')
  }

  return { htmlUrl, baseSha, headSha, cloneUrl, sshUrl }
}
