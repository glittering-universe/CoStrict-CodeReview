/* Env variables:
 * OPENAI_API_KEY
In CI:
 * GITHUB_SHA
 * BASE_SHA
 * GITHUB_TOKEN
 */

import { logger } from './common/utils/logger'

export const githubToken = (): string => {
  if (!process.env.GITHUB_TOKEN) {
    logger.error('GITHUB_TOKEN is not set')
  }

  return process.env.GITHUB_TOKEN ?? ''
}

export const getGitHubEnvVariables = (): Record<string, string> => {
  const envVars = ['GITHUB_SHA', 'BASE_SHA', 'GITHUB_TOKEN']
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

  return {
    githubSha: process.env.GITHUB_SHA ?? '',
    baseSha: process.env.BASE_SHA ?? '',
    githubToken: process.env.GITHUB_TOKEN ?? '',
  }
}
