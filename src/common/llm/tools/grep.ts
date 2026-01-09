import fs from 'node:fs/promises'
import path from 'node:path'
import { tool } from 'ai'
import { glob } from 'tinyglobby'
import { z } from 'zod'
import { resolveWorkspacePath } from '../../git/getChangedFilesNames'

type FileEntry = {
  displayPath: string
  fullPath: string
}

const toDisplayPath = (filePath: string): string => {
  const workspaceRoot = resolveWorkspacePath('.')
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot) || !path.isAbsolute(filePath)) {
    return filePath
  }
  const relativePath = path.relative(workspaceRoot, filePath)
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return filePath
  }
  return relativePath
}

export const grepTool = tool({
  description:
    'Search for a pattern in files. Returns matching lines with line numbers and file paths.',
  parameters: z.object({
    pattern: z.string().describe('The pattern to search for (supports JavaScript regex)'),
    path: z
      .string()
      .describe('Directory or file path to search in. Default is the current directory.')
      .default('.'),
    glob: z
      .string()
      .describe('Glob pattern for filtering files (e.g., "**/*.ts" for TypeScript files)')
      .default('**/*.*'),
    ignoreCase: z
      .boolean()
      .describe('Whether to ignore case when matching')
      .default(false),
    maxResults: z.number().describe('Maximum number of results to return').default(30),
  }),
  execute: async ({
    pattern,
    path: searchPath,
    glob: globPattern,
    ignoreCase,
    maxResults,
  }) => {
    try {
      const resolvedSearchPath = resolveWorkspacePath(searchPath)
      const entries: FileEntry[] = []

      let searchStat: Awaited<ReturnType<typeof fs.stat>> | null = null
      try {
        searchStat = await fs.stat(resolvedSearchPath)
      } catch {
        searchStat = null
      }

      if (searchStat?.isFile()) {
        entries.push({
          displayPath: toDisplayPath(resolvedSearchPath),
          fullPath: resolvedSearchPath,
        })
      } else {
        const files = await glob(globPattern, {
          cwd: resolvedSearchPath,
          onlyFiles: true,
          dot: false,
        })

        for (const file of files) {
          entries.push({
            displayPath: file,
            fullPath: path.resolve(resolvedSearchPath, file),
          })
        }
      }

      const regex = new RegExp(pattern, ignoreCase ? 'i' : '')

      const results: string[] = []
      let resultCount = 0

      for (const entry of entries) {
        if (resultCount >= maxResults) break

        try {
          const content = await fs.readFile(entry.fullPath, 'utf-8')
          const lines = content.split('\n')

          for (let i = 0; i < lines.length; i++) {
            if (resultCount >= maxResults) break

            const line = lines[i]
            if (regex.test(line)) {
              results.push(`${entry.displayPath}:${i + 1}: ${line.trim()}`)
              resultCount++
            }
          }
        } catch (err) {
          // Skip files that can't be read
        }
      }

      if (results.length === 0) {
        return `No matches found for pattern "${pattern}" in ${entries.length} files.`
      }

      return `Found ${results.length} matches for pattern "${pattern}":\n\n${results.join('\n')}`
    } catch (error) {
      return `Error searching files: ${error instanceof Error ? error.message : String(error)}`
    }
  },
})
