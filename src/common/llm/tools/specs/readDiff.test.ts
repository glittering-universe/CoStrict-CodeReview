import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { withGitHubEnvVariables } from '../../../../config'
import { withWorkspaceRoot } from '../../../git/getChangedFilesNames'
import type { PlatformProvider } from '../../../platform/provider'
import { PlatformOptions } from '../../../types'
import { createReadDiffTool } from '../readDiff'

describe('readDiffTool', () => {
  test('uses GitHub API diff when pullRequest context is present', async () => {
    const repoRoot = process.cwd()
    const workspaceRoot = await mkdtemp(path.join(repoRoot, 'read-diff-tool-test-'))

    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(
        [
          'diff --git a/file.txt b/file.txt',
          'index 1111111..2222222 100644',
          '--- a/file.txt',
          '+++ b/file.txt',
          '@@ -1 +1 @@',
          '-old',
          '+new',
          '',
          'diff --git a/other.txt b/other.txt',
          'index 3333333..4444444 100644',
          '--- a/other.txt',
          '+++ b/other.txt',
          '@@ -1 +1 @@',
          '-before',
          '+after',
          '',
        ].join('\n'),
        { status: 200 }
      )

    try {
      await writeFile(path.join(workspaceRoot, 'file.txt'), 'new\n')

      const platformProvider: PlatformProvider = {
        postReviewComment: async () => undefined,
        postThreadComment: async () => undefined,
        submitUsage: async () => {},
        getPlatformOption: (): PlatformOptions => PlatformOptions.GITHUB,
        getRepoId: () => 'github_repo_anonymous',
      }

      const tool = createReadDiffTool(platformProvider)

      const output = await withWorkspaceRoot(workspaceRoot, async () =>
        withGitHubEnvVariables(
          {
            githubSha: 'head-sha',
            baseSha: 'base-sha',
            githubToken: 'token123',
            pullRequest: { owner: 'example', repo: 'repo', number: 2 },
          },
          () => tool.execute({ path: path.join(workspaceRoot, 'file.txt') })
        )
      )

      expect(output).toContain('diff --git a/file.txt b/file.txt')
      expect(output).toContain('+new')
      expect(output).not.toContain('other.txt')
    } finally {
      globalThis.fetch = originalFetch
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})
