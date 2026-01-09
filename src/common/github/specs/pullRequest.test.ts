import { describe, expect, test } from 'bun:test'
import { parseGitHubPullRequestUrl, toGitHubPullRequestUrl } from '../pullRequest'

describe('parseGitHubPullRequestUrl', () => {
  test('parses canonical GitHub pull URL', () => {
    const parsed = parseGitHubPullRequestUrl(
      'https://github.com/ai-code-review-evaluation/sentry-greptile/pull/12'
    )
    expect(parsed).toEqual({
      owner: 'ai-code-review-evaluation',
      repo: 'sentry-greptile',
      number: 12,
    })
  })

  test('parses GitHub pull URL with suffix path/query', () => {
    const parsed = parseGitHubPullRequestUrl(
      'https://github.com/ai-code-review-evaluation/cal.com-greptile/pull/11/files?foo=bar'
    )
    expect(parsed).toEqual({
      owner: 'ai-code-review-evaluation',
      repo: 'cal.com-greptile',
      number: 11,
    })
  })

  test('parses github.com without protocol', () => {
    const parsed = parseGitHubPullRequestUrl(
      'github.com/ai-code-review-evaluation/grafana-greptile/pull/1'
    )
    expect(parsed).toEqual({
      owner: 'ai-code-review-evaluation',
      repo: 'grafana-greptile',
      number: 1,
    })
  })

  test('parses shorthand owner/repo#number', () => {
    const parsed = parseGitHubPullRequestUrl(
      'ai-code-review-evaluation/keycloak-greptile#7'
    )
    expect(parsed).toEqual({
      owner: 'ai-code-review-evaluation',
      repo: 'keycloak-greptile',
      number: 7,
    })
  })

  test('rejects non-PR GitHub URLs', () => {
    expect(
      parseGitHubPullRequestUrl(
        'https://github.com/ai-code-review-evaluation/sentry-greptile'
      )
    ).toBeNull()
  })

  test('formats canonical URL', () => {
    expect(
      toGitHubPullRequestUrl({
        owner: 'ai-code-review-evaluation',
        repo: 'sentry-greptile',
        number: 5,
      })
    ).toBe('https://github.com/ai-code-review-evaluation/sentry-greptile/pull/5')
  })
})
