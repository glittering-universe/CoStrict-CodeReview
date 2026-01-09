export type GitHubPullRequestRef = {
  owner: string
  repo: string
  number: number
}

const isValidOwnerSegment = (value: string): boolean => /^[A-Za-z0-9-]+$/.test(value)

const isValidRepoSegment = (value: string): boolean => /^[A-Za-z0-9._-]+$/.test(value)

const parseOwnerRepoNumber = (owner: string, repo: string, number: string) => {
  if (!isValidOwnerSegment(owner) || !isValidRepoSegment(repo)) return null
  const parsed = Number.parseInt(number, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return { owner, repo, number: parsed } satisfies GitHubPullRequestRef
}

export const parseGitHubPullRequestUrl = (input: string): GitHubPullRequestRef | null => {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Shorthand: owner/repo#123
  const shorthandMatch = trimmed.match(/^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)#(\d+)$/)
  if (shorthandMatch) {
    const [, owner, repo, number] = shorthandMatch
    return parseOwnerRepoNumber(owner, repo, number)
  }

  // Allow github.com/owner/repo/pull/123 without protocol.
  const urlCandidate =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : trimmed.startsWith('github.com/')
        ? `https://${trimmed}`
        : null
  if (!urlCandidate) return null

  let parsedUrl: URL
  try {
    parsedUrl = new URL(urlCandidate)
  } catch {
    return null
  }

  if (!/^(?:www\.)?github\.com$/i.test(parsedUrl.hostname)) return null

  const segments = parsedUrl.pathname.split('/').filter(Boolean)
  if (segments.length < 4) return null

  const [owner, repo, type, number] = segments
  if (type !== 'pull') return null

  return parseOwnerRepoNumber(owner, repo, number)
}

export const toGitHubPullRequestUrl = (ref: GitHubPullRequestRef): string =>
  `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`
