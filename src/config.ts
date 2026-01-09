/* Env variables:
 * OPENAI_API_KEY
In CI:
 * GITHUB_SHA
 * BASE_SHA
 * GITHUB_TOKEN
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { GitHubPullRequestRef } from './common/github/pullRequest'
import { logger } from './common/utils/logger'

export const githubToken = (): string => {
  if (!process.env.GITHUB_TOKEN) {
    logger.error('GITHUB_TOKEN is not set')
  }

  return process.env.GITHUB_TOKEN ?? ''
}

type GitHubEnvVariables = {
  githubSha: string
  baseSha: string
  githubToken: string
  pullRequest?: GitHubPullRequestRef
  pullRequestDiff?: string
}

const githubEnvStorage = new AsyncLocalStorage<GitHubEnvVariables>()

export const withGitHubEnvVariables = async <T>(
  env: GitHubEnvVariables,
  fn: () => Promise<T>
): Promise<T> => {
  const base: GitHubEnvVariables = {
    githubSha: env.githubSha.trim(),
    baseSha: env.baseSha.trim(),
    githubToken: env.githubToken,
  }
  const normalized: GitHubEnvVariables = {
    ...base,
    ...(env.pullRequest ? { pullRequest: env.pullRequest } : {}),
    ...(env.pullRequestDiff ? { pullRequestDiff: env.pullRequestDiff } : {}),
  }
  return githubEnvStorage.run(normalized, fn)
}

export const getGitHubEnvVariables = (): GitHubEnvVariables => {
  const stored = githubEnvStorage.getStore()
  if (stored) return stored

  const envVars = ['GITHUB_SHA', 'BASE_SHA']
  const missingVars: string[] = []

  for (const envVar of envVars) {
    if (!process.env[envVar]) {
      missingVars.push(envVar)
    }
  }

  if (missingVars.length > 0) {
    logger.error(`Missing environment variables: ${missingVars.join(', ')}`)
    throw new Error('One or more GitHub environment variables are not set')
  }

  if (!process.env.GITHUB_TOKEN) {
    logger.error('Missing environment variables: GITHUB_TOKEN')
  }

  return {
    githubSha: process.env.GITHUB_SHA ?? '',
    baseSha: process.env.BASE_SHA ?? '',
    githubToken: process.env.GITHUB_TOKEN ?? '',
  }
}
