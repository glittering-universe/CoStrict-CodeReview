import { promises as fs } from 'node:fs'
import { tool } from 'ai'
import { z } from 'zod'
import { getLanguageName } from '../../../review/prompt/utils/fileLanguage'

const resolveMaxFileExcerptChars = (): number => {
  const raw = process.env.COSTRICT_MAX_FILE_EXCERPT_CHARS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 40_000
}

const truncateWithMessage = (input: string, maxChars: number): string => {
  if (input.length <= maxChars) return input
  const headChars = Math.max(0, Math.floor(maxChars * 0.85))
  const tailChars = Math.max(0, maxChars - headChars)
  const head = input.slice(0, headChars)
  const tail = input.slice(-tailChars)
  return `${head}\n\n... [excerpt truncated: ${input.length} chars total, showing ${headChars}+${tailChars}] ...\n\n${tail}`
}

export const readFileTool = tool({
  description:
    'Read the current state of a file or part of a file. You should use this tool to gather specific context. You should use this in conjunction with the read_diff tool to get the full picture of the changes. You should read several lines before and after the changes. You may need to go back and read more lines.',
  parameters: z.object({
    path: z.string().describe('The absolute path to the file to read'),
    startLine: z.number().optional().describe('The line number to start reading from.'),
    endLine: z.number().optional().describe('The line number to end reading at.'),
  }),
  execute: async ({ path, startLine, endLine }) => {
    try {
      const file = await fs.readFile(path, 'utf-8')
      const lines = file.split('\n')

      const defaultLinesToRead = 200

      const startIndex = startLine ? startLine - 1 : 0
      const endIndex = endLine ? endLine - 1 : startIndex + defaultLinesToRead

      const selectedLines = lines.slice(startIndex, endIndex + 1)
      const content = selectedLines.join('\n')

      const prefix = `Here is the file excerpt you requested. NOTE that unless an EOF is shown, the file is not complete. File path: ${path}\nLines Selected: ${startIndex + 1} to ${endIndex + 1}:\n\n`
      const language = getLanguageName(path, '')

      const formatted = `${prefix}\`\`\`${language.toLowerCase()}\n${content}\`\`\``
      return truncateWithMessage(formatted, resolveMaxFileExcerptChars())
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
          return `Error: File not found at path '${path}'. The file does not exist or the path is incorrect. Use the 'ls' tool to explore the directory structure and find the correct path.`
        }
        if (error.message.includes('EACCES')) {
          return `Error: Permission denied when trying to read file '${path}'. You don't have read access to this file.`
        }
        if (error.message.includes('EISDIR')) {
          return `Error: '${path}' is a directory, not a file. Use the 'ls' tool to list directory contents instead.`
        }
        return `Error reading file '${path}': ${error.message}`
      }
      return `Unknown error occurred while reading file '${path}'`
    }
  },
})
