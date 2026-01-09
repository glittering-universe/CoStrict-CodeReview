import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { scanLocalGitRepos } from '../scanLocalRepos'

const makeGitDirRepo = async (root: string, name: string) => {
  const repoPath = path.join(root, name)
  await mkdir(path.join(repoPath, '.git'), { recursive: true })
  return repoPath
}

const makeGitFileRepo = async (root: string, name: string) => {
  const repoPath = path.join(root, name)
  await mkdir(repoPath, { recursive: true })
  await writeFile(path.join(repoPath, '.git'), 'gitdir: /fake', 'utf8')
  return repoPath
}

describe('scanLocalGitRepos', () => {
  test('finds repositories and skips ignored directories', async () => {
    const tempRoot = await mkdtemp(path.join(process.cwd(), 'scan-local-repos-'))

    try {
      const repoA = await makeGitDirRepo(tempRoot, 'alpha')
      const repoB = await makeGitFileRepo(path.join(tempRoot, 'nested'), 'beta')
      const ignoredRepo = await makeGitDirRepo(
        path.join(tempRoot, 'node_modules'),
        'ignored'
      )

      const result = await scanLocalGitRepos({
        roots: [tempRoot],
        maxDepth: 3,
        maxResults: 10,
      })

      const repoPaths = result.repos.map((repo) => repo.path)
      expect(repoPaths).toContain(repoA)
      expect(repoPaths).toContain(repoB)
      expect(repoPaths).not.toContain(ignoredRepo)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  test('honors maxResults when scanning', async () => {
    const tempRoot = await mkdtemp(path.join(process.cwd(), 'scan-local-repos-'))

    try {
      await makeGitDirRepo(tempRoot, 'alpha')
      await makeGitDirRepo(tempRoot, 'beta')

      const result = await scanLocalGitRepos({
        roots: [tempRoot],
        maxDepth: 1,
        maxResults: 1,
      })

      expect(result.repos.length).toBe(1)
      expect(result.truncated).toBe(true)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  test('keeps traversing inside repositories', async () => {
    const tempRoot = await mkdtemp(path.join(process.cwd(), 'scan-local-repos-'))

    try {
      const parentRepo = await makeGitDirRepo(tempRoot, 'parent')
      const nestedRepo = await makeGitDirRepo(path.join(parentRepo, 'nested'), 'child')

      const result = await scanLocalGitRepos({
        roots: [parentRepo],
        maxDepth: 3,
        maxResults: 10,
      })

      const repoPaths = result.repos.map((repo) => repo.path)
      expect(repoPaths).toContain(parentRepo)
      expect(repoPaths).toContain(nestedRepo)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
