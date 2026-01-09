import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { logger } from '../utils/logger'
import type { GitHubPullRequestRef } from './pullRequest'

const runCommand = async (
  command: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> => {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    const message = stderr.trim() || stdout.trim()
    throw new Error(
      message || `${command} ${args.join(' ')} failed with exit code ${exitCode}`
    )
  }

  return { stdout, stderr }
}

const runGit = async (
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> => runCommand('git', args, cwd)

const runTar = async (
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> => runCommand('tar', args, cwd)

export type GitHubPullRequestCheckout = {
  workspaceRoot: string
  baseSha: string
  headSha: string
  cleanup: () => Promise<void>
  checkoutMethod: 'git_https' | 'git_ssh' | 'archive'
}

const resolveGitHubApiBaseUrl = (): string => {
  const raw = process.env.COSTRICT_GITHUB_API_BASE_URL
  const trimmed = raw?.trim().replace(/\/$/, '')
  return trimmed || 'https://api.github.com'
}

const downloadToFile = async ({
  url,
  headers,
  destinationPath,
}: {
  url: string
  headers: Record<string, string>
  destinationPath: string
}): Promise<void> => {
  const response = await fetch(url, { headers })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const snippet = body.trim().slice(0, 500)
    throw new Error(
      `Download failed (${response.status})${snippet ? `: ${snippet}` : ''}`
    )
  }
  if (!response.body) {
    throw new Error('Download failed: empty response body.')
  }

  await pipeline(
    Readable.fromWeb(response.body as unknown as ReadableStream),
    createWriteStream(destinationPath)
  )
}

const extractTarball = async ({
  archivePath,
  workspaceRoot,
}: {
  archivePath: string
  workspaceRoot: string
}): Promise<void> => {
  await runTar(
    ['-xzf', archivePath, '-C', workspaceRoot, '--strip-components=1'],
    workspaceRoot
  )
}

export const checkoutGitHubPullRequest = async ({
  cloneUrl,
  sshUrl,
  pullRequest,
  baseSha,
  headSha,
  token,
}: {
  cloneUrl: string
  sshUrl?: string
  pullRequest: GitHubPullRequestRef
  baseSha: string
  headSha: string
  token?: string
}): Promise<GitHubPullRequestCheckout> => {
  let workspaceRoot = await mkdtemp(path.join(tmpdir(), 'costrict-gh-pr-'))
  const cleanup = async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  }

  try {
    logger.info(`Preparing GitHub PR checkout in ${workspaceRoot}`)

    const checkoutWithRemote = async (
      remoteUrl: string,
      checkoutMethod: GitHubPullRequestCheckout['checkoutMethod']
    ): Promise<GitHubPullRequestCheckout> => {
      await runGit(['init'], workspaceRoot)
      await runGit(['remote', 'add', 'origin', remoteUrl], workspaceRoot)

      // Fetch the PR head ref from the base repository (works for forked PRs too).
      await runGit(
        ['fetch', '--no-tags', '--depth=1', 'origin', `pull/${pullRequest.number}/head`],
        workspaceRoot
      )

      await runGit(['checkout', '--detach', 'FETCH_HEAD'], workspaceRoot)
      const checkedOutSha = (
        await runGit(['rev-parse', 'HEAD'], workspaceRoot)
      ).stdout.trim()

      return {
        workspaceRoot,
        baseSha,
        headSha: checkedOutSha || headSha,
        cleanup,
        checkoutMethod,
      }
    }

    const resetWorkspace = async () => {
      await cleanup()
      workspaceRoot = await mkdtemp(path.join(tmpdir(), 'costrict-gh-pr-'))
    }

    try {
      return await checkoutWithRemote(cloneUrl, 'git_https')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const candidate = sshUrl?.trim()
      if (candidate) {
        logger.warn(
          `GitHub PR checkout failed via HTTPS (${message}). Retrying with SSH remote...`
        )
        await resetWorkspace()
        return await checkoutWithRemote(candidate, 'git_ssh')
      }
      throw error
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(
      `GitHub PR checkout via git failed (${message}). Falling back to tarball...`
    )

    try {
      await cleanup()
      workspaceRoot = await mkdtemp(path.join(tmpdir(), 'costrict-gh-pr-'))

      const apiBaseUrl = resolveGitHubApiBaseUrl()
      const urlCandidates = [
        `${apiBaseUrl}/repos/${pullRequest.owner}/${pullRequest.repo}/tarball/refs/pull/${pullRequest.number}/head`,
        `${apiBaseUrl}/repos/${pullRequest.owner}/${pullRequest.repo}/tarball/pull/${pullRequest.number}/head`,
        `${apiBaseUrl}/repos/${pullRequest.owner}/${pullRequest.repo}/tarball/${headSha}`,
      ]

      const headers: Record<string, string> = {
        accept: 'application/vnd.github+json',
        'user-agent': 'costrict-web',
      }
      const trimmedToken = token?.trim()
      if (trimmedToken) {
        headers.authorization = `Bearer ${trimmedToken}`
      }

      const archivePath = path.join(workspaceRoot, 'repo.tar.gz')
      let lastError: unknown = null
      for (const url of urlCandidates) {
        try {
          await downloadToFile({ url, headers, destinationPath: archivePath })
          await extractTarball({ archivePath, workspaceRoot })
          await rm(archivePath, { force: true })
          return {
            workspaceRoot,
            baseSha,
            headSha,
            cleanup,
            checkoutMethod: 'archive',
          }
        } catch (downloadError) {
          lastError = downloadError
          await rm(archivePath, { force: true })
        }
      }

      const lastMessage =
        lastError instanceof Error
          ? lastError.message
          : lastError
            ? String(lastError)
            : ''
      throw new Error(
        `Failed to download GitHub PR tarball${lastMessage ? `: ${lastMessage}` : ''}`
      )
    } catch (fallbackError) {
      await cleanup()
      throw fallbackError
    }
  }
}
