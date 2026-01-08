import { exec } from 'node:child_process'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isAbsolute, join, resolve } from 'node:path'

import { getGitHubEnvVariables } from '../../config'
import { PlatformOptions } from '../types'
import { logger } from '../utils/logger'

export const getDiffCommand = (isCi: string | undefined): string => {
  const diffOptions = '--diff-filter=AMRT -U0'

  if (isCi === PlatformOptions.GITHUB) {
    const { githubSha, baseSha } = getGitHubEnvVariables()
    return `git diff ${diffOptions} ${baseSha} ${githubSha}`
  }

  if (isCi === PlatformOptions.LOCAL) {
    return `git diff ${diffOptions} --cached`
  }

  throw new Error('Invalid CI platform')
}

const workspaceRootStorage = new AsyncLocalStorage<string>()

export const withWorkspaceRoot = async <T>(
  workspaceRoot: string,
  fn: () => Promise<T>
): Promise<T> => {
  const normalizedRoot = resolve(workspaceRoot)
  return workspaceRootStorage.run(normalizedRoot, fn)
}

export const getWorkspaceRoot = (): string | undefined =>
  workspaceRootStorage.getStore()

export const resolveWorkspacePath = (input: string): string => {
  const workspaceRoot = workspaceRootStorage.getStore()
  if (!workspaceRoot) return input
  const trimmed = input.trim()
  if (!trimmed || trimmed === '.' || trimmed === './' || trimmed === '.\\') {
    return workspaceRoot
  }
  if (isAbsolute(trimmed)) return trimmed
  return resolve(workspaceRoot, trimmed)
}

export const resolveGitRootFromPath = (cwd: string): Promise<string> => {
  const normalizedCwd = resolve(cwd)
  return new Promise((resolveGitRoot, reject) => {
    exec('git rev-parse --show-toplevel', { cwd: normalizedCwd }, (error, stdout) => {
      if (error) {
        reject(new Error(`Failed to find git root. Error: ${error.message}`))
      } else {
        resolveGitRoot(stdout.trim())
      }
    })
  })
}

export const getGitRoot = (): Promise<string> => {
  const workspaceRoot = workspaceRootStorage.getStore()
  if (workspaceRoot) {
    return Promise.resolve(workspaceRoot)
  }
  return resolveGitRootFromPath(process.cwd())
}

export const getChangedFilesNames = async (
  isCi: string | undefined
): Promise<string[]> => {
  const gitRoot = await getGitRoot()
  logger.debug('gitRoot', gitRoot)
  const nameOnlyCommand = getDiffCommand(isCi).replace('-U0', '--name-only')
  logger.debug('nameOnlyCommand', nameOnlyCommand)
  return new Promise((resolve, reject) => {
    exec(nameOnlyCommand, { cwd: gitRoot }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Failed to execute command. Error: ${error.message}`))
      } else if (stderr) {
        reject(new Error(`Command execution error: ${stderr}`))
      } else {
        const files = stdout
          .split('\n')
          .filter((fileName) => fileName.trim() !== '')
          .map((fileName) => join(gitRoot, fileName.trim()))
        resolve(files)
      }
    })
  })
}
