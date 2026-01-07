import { exec } from 'node:child_process'
import { relative, sep } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { getDiffCommand } from '../../git/getChangedFilesNames'
import { getGitRoot } from '../../git/getChangedFilesNames'
import type { PlatformProvider } from '../../platform/provider'
import { logger } from '../../utils/logger'

const resolveMaxDiffChars = (): number => {
  const raw = process.env.COSTRICT_MAX_DIFF_CHARS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 40_000
}

const truncateWithHeadTail = (
  input: string,
  maxChars: number
): { truncated: boolean; text: string } => {
  if (input.length <= maxChars) return { truncated: false, text: input }

  const headChars = Math.max(0, Math.floor(maxChars * 0.7))
  const tailChars = Math.max(0, maxChars - headChars)

  const head = input.slice(0, headChars)
  const tail = input.slice(-tailChars)

  return {
    truncated: true,
    text: `${head}\n\n... [diff truncated: ${input.length} chars total, showing ${headChars}+${tailChars}] ...\n\n${tail}`,
  }
}

export const createReadDiffTool = (platformProvider: PlatformProvider) =>
  tool({
    description:
      'Generate a diff for a file. This tool shows changes made to a file which should be reviewed. Use in conjunction with read_file to read the current state of a file.',
    parameters: z.object({
      path: z.string().describe('The absolute path to the file to generate a diff for'),
    }),
    execute: async ({ path }) => {
      try {
        const platformOption = platformProvider.getPlatformOption()
        const diffCommandBase = getDiffCommand(platformOption)
        const maxDiffChars = resolveMaxDiffChars()
        const gitRoot = await getGitRoot()

        // Normalize path for Windows environment
        // Convert WSL path (/mnt/...) to Windows path if needed
        // Then convert absolute path to relative path from git root
        let normalizedPath = path

        // Handle WSL-style paths on Windows (e.g., /mnt/c/Users/...)
        if (process.platform === 'win32' && path.startsWith('/mnt/')) {
          // Remove /mnt/ and convert first letter to drive letter
          const wslPathMatch = path.match(/^\/mnt\/([a-z])\/(.*)$/i)
          if (wslPathMatch) {
            const driveLetter = wslPathMatch[1].toUpperCase()
            const restPath = wslPathMatch[2].replace(/\//g, '\\')
            normalizedPath = `${driveLetter}:\\${restPath}`
            logger.debug(
              `Converted WSL path to Windows path: ${path} -> ${normalizedPath}`
            )
          }
        }

        // Convert absolute path to relative path from git root
        let relativePath = normalizedPath
        try {
          relativePath = relative(gitRoot, normalizedPath)
          // Use forward slashes for git commands on all platforms
          relativePath = relativePath.replace(/\\/g, '/')
          logger.debug(`Converted to relative path: ${normalizedPath} -> ${relativePath}`)
        } catch (error) {
          logger.debug(`Failed to make path relative, using original: ${error}`)
          // If relative() fails, use original path with forward slashes
          relativePath = normalizedPath.replace(/\\/g, '/')
        }

        const diffCommand = `${diffCommandBase} -- "${relativePath}"`

        return await new Promise<string>((resolve, reject) => {
          // Use exec like other git commands in the codebase
          exec(
            diffCommand,
            { cwd: gitRoot, maxBuffer: 1024 * 1024 * 10 },
            (error, stdout, stderr) => {
              // Git diff can exit with code 1 when there are differences; treat that as success
              if (error && error.code !== 0 && error.code !== 1) {
                // Log full details for debugging instead of rejecting, to avoid silent stops
                logger.error(`Git diff error: ${error.message}`)
                if (stderr) logger.error(`Git diff stderr: ${stderr}`)

                // Resolve with a helpful message rather than rejecting so calling tools
                // (LLM tool wrappers) don't silently terminate the session.
                return resolve(
                  `Error running git diff: ${error.message}${stderr ? `; stderr: ${stderr}` : ''}`
                )
              }

              if (stderr) {
                logger.warn(`Git diff stderr: ${stderr}`)
              }

              const diff = stdout || 'No changes detected'
              const { truncated, text } = truncateWithHeadTail(diff, maxDiffChars)
              if (truncated) {
                logger.warn(
                  `Diff output for ${path} was truncated to ${maxDiffChars} chars to avoid context overflow.`
                )
              }
              resolve(text)
            }
          )
        })
      } catch (error) {
        logger.error(`Failed to generate diff: ${error}`)
        return `Error generating diff: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
