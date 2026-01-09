import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

export type LocalGitRepo = {
  name: string
  path: string
}

export type LocalRepoScanResult = {
  repos: LocalGitRepo[]
  truncated: boolean
}

export type LocalRepoScanOptions = {
  roots: string[]
  maxDepth: number
  maxResults: number
  ignoredDirs?: string[]
}

const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'target',
  '.cache',
  '.npm',
  '.pnpm-store',
  '.yarn',
  '.bun',
  '.DS_Store',
  '.idea',
  '.vscode',
])

const normalizeRoots = (roots: string[]): string[] => {
  const unique = new Set<string>()
  for (const root of roots) {
    const trimmed = root.trim()
    if (!trimmed) continue
    unique.add(path.resolve(trimmed))
  }
  return Array.from(unique)
}

export const scanLocalGitRepos = async (
  options: LocalRepoScanOptions
): Promise<LocalRepoScanResult> => {
  const roots = normalizeRoots(options.roots)
  const ignoredDirs = new Set([...DEFAULT_IGNORED_DIRS, ...(options.ignoredDirs ?? [])])

  const repos = new Map<string, LocalGitRepo>()
  let truncated = false

  const stack = roots.map((root) => ({ path: root, depth: 0 }))

  while (stack.length > 0) {
    if (repos.size >= options.maxResults) {
      truncated = true
      break
    }

    const current = stack.pop()
    if (!current) break

    let entries: Dirent[]
    try {
      entries = await readdir(current.path, { withFileTypes: true })
    } catch {
      continue
    }

    const hasGitMarker = entries.some(
      (entry) =>
        entry.name === '.git' &&
        (entry.isDirectory() || entry.isFile() || entry.isSymbolicLink())
    )

    if (hasGitMarker) {
      const repoPath = current.path
      if (!repos.has(repoPath)) {
        repos.set(repoPath, {
          name: path.basename(repoPath) || repoPath,
          path: repoPath,
        })
      }
    }

    if (current.depth >= options.maxDepth) {
      continue
    }

    const sortedEntries = entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((name) => !ignoredDirs.has(name))
      .sort((a, b) => a.localeCompare(b))

    for (let i = sortedEntries.length - 1; i >= 0; i -= 1) {
      const name = sortedEntries[i]
      stack.push({
        path: path.join(current.path, name),
        depth: current.depth + 1,
      })
    }
  }

  const sortedRepos = Array.from(repos.values()).sort((a, b) =>
    a.path.localeCompare(b.path)
  )

  return { repos: sortedRepos, truncated }
}
