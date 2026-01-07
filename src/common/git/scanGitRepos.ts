import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, resolve } from 'node:path'
import { logger } from '../utils/logger'

export type LocalRepoInfo = {
  path: string
  name: string
}

type ScanOptions = {
  roots?: string[]
  maxDepth?: number
  maxRepos?: number
  ignoredNames?: string[]
}

const DEFAULT_IGNORED = new Set([
  '.git',
  '.cache',
  '.costrict',
  '.local',
  '.npm',
  '.pnpm-store',
  '.yarn',
  '.bun',
  '.cargo',
  '.rustup',
  '.ssh',
  '.gnupg',
  '.vscode',
  '.idea',
  'node_modules',
  'dist',
  'build',
  'target',
  'vendor',
  'Library',
  'AppData',
])

const normalizeRoots = (roots: string[]): string[] => {
  const output: string[] = []
  const seen = new Set<string>()

  for (const root of roots) {
    const trimmed = root.trim()
    if (!trimmed) continue
    const resolved = resolve(trimmed)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    output.push(resolved)
  }

  return output
}

export const resolveScanRoots = (): string[] => {
  const raw = process.env.COSTRICT_REPO_SCAN_ROOTS
  if (raw) {
    return normalizeRoots(raw.split(delimiter))
  }
  return normalizeRoots([homedir(), process.cwd()])
}

export const resolveScanDepth = (): number => {
  const raw = process.env.COSTRICT_REPO_SCAN_MAX_DEPTH
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 1) return parsed
  return 6
}

export const resolveScanMaxRepos = (): number => {
  const raw = process.env.COSTRICT_REPO_SCAN_MAX_REPOS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 1) return parsed
  return 250
}

export const scanGitRepositories = async (
  options: ScanOptions = {}
): Promise<LocalRepoInfo[]> => {
  const roots = normalizeRoots(options.roots ?? resolveScanRoots())
  const maxDepth = options.maxDepth ?? resolveScanDepth()
  const maxRepos = options.maxRepos ?? resolveScanMaxRepos()
  const ignoredNames = new Set(DEFAULT_IGNORED)

  for (const name of options.ignoredNames ?? []) {
    if (name.trim()) {
      ignoredNames.add(name.trim())
    }
  }

  const repos: LocalRepoInfo[] = []
  const visited = new Set<string>()
  const queue: Array<{ path: string; depth: number }> = roots.map((path) => ({
    path,
    depth: 0,
  }))

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    if (visited.has(current.path)) continue
    visited.add(current.path)

    let entries: Dirent[]
    try {
      entries = await readdir(current.path, { withFileTypes: true })
    } catch (error) {
      logger.debug(`Skipping scan path ${current.path}: ${String(error)}`)
      continue
    }

    const hasGit = entries.some((entry) => entry.name === '.git')
    if (hasGit) {
      repos.push({ path: current.path, name: basename(current.path) || current.path })
      if (repos.length >= maxRepos) break
    }

    if (current.depth >= maxDepth) {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.isSymbolicLink()) continue
      if (ignoredNames.has(entry.name)) continue

      queue.push({
        path: resolve(current.path, entry.name),
        depth: current.depth + 1,
      })
    }
  }

  return repos.sort((a, b) => a.path.localeCompare(b.path))
}
