import { getGitRoot } from '../../common/git/getChangedFilesNames'
import type { ReviewFile } from '../../common/types'
import { createFileInfo } from './fileInfo'
import { instructionPrompt } from './prompts'
import { getLanguageName } from './utils/fileLanguage'

export const constructPrompt = async (
  files: ReviewFile[],
  reviewLanguage: string,
  customInstructions?: string
): Promise<string> => {
  const workspaceRoot = await getGitRoot()

  const languageName = files.length > 0 ? getLanguageName(files[0].fileName) : 'default'

  const languageToInstructionPrompt = instructionPrompt
    .replace('{ProgrammingLanguage}', languageName)
    .replace('{ReviewLanguage}', reviewLanguage)

  const fileInfo = createFileInfo(files, workspaceRoot)

  const customInstructionsSection = customInstructions
    ? `\n\n// Custom Instructions\n${customInstructions}\n`
    : ''

  return `${languageToInstructionPrompt}${customInstructionsSection}\n${fileInfo}`
}
