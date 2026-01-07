import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { scanGitRepositories } from '../scanGitRepos'

describe('scanGitRepositories', () => {
  test('finds git repositories and skips ignored directories', async () => {
    const repoRoot = process.cwd()
    const tempRoot = await mkdtemp(join(repoRoot, 'repo-scan-test-'))

    try {
      await mkdir(join(tempRoot, '.git'), { recursive: true })
      const repoA = join(tempRoot, 'repo-a')
      const repoB = join(tempRoot, 'repo-b')
      const repoC = join(tempRoot, 'deep', 'level1', 'level2', 'repo-c')
      const ignoredRepo = join(tempRoot, 'node_modules', 'skip-repo')

      await mkdir(join(repoA, '.git'), { recursive: true })
      await mkdir(repoB, { recursive: true })
      await writeFile(join(repoB, '.git'), 'gitdir: /tmp/fake', 'utf8')
      await mkdir(join(repoC, '.git'), { recursive: true })
      await mkdir(join(ignoredRepo, '.git'), { recursive: true })

      const results = await scanGitRepositories({
        roots: [tempRoot],
        maxDepth: 6,
        maxRepos: 20,
      })

      const paths = results.map((repo) => repo.path)
      expect(paths).toContain(tempRoot)
      expect(paths).toContain(repoA)
      expect(paths).toContain(repoB)
      expect(paths).toContain(repoC)
      expect(paths).not.toContain(ignoredRepo)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
