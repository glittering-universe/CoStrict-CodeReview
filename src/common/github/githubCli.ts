import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from '../utils/logger'

const execFileAsync = promisify(execFile)

export const resolveGitHubTokenFromGh = async (): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['auth', 'token', '--hostname', 'github.com'],
      { timeout: 5000 }
    )
    return stdout.trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.debug(`gh auth token unavailable: ${message}`)
    return ''
  }
}
