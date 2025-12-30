import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { password } from '@inquirer/prompts'

import { type ConfigureArgs, PlatformOptions } from '../common/types'
import { logger } from '../common/utils/logger'
import { findTemplateFile } from './findTemplateFile'

export const configure = async (yargs: ConfigureArgs): Promise<void> => {
  if (yargs.platform === PlatformOptions.GITHUB) {
    await configureGitHub()
  }
}

const captureGitHubApiKey = async (): Promise<string | undefined> => {
  const apiKey = await password({
    message: 'Please input your OpenAI API key (leave blank to use GitHub Models):',
    mask: '*',
  })

  if (!apiKey) {
    logger.info('No API key provided, using GitHub Models.')
    return undefined
  }

  return apiKey
}

const configureGitHub = async () => {
  const apiKey = await captureGitHubApiKey()

  // Choose template based on whether we're using GitHub Models or OpenAI
  const templateName = apiKey ? 'github-pr.yml' : 'github-pr-models.yml'
  const githubWorkflowTemplate = await findTemplateFile(`**/templates/${templateName}`)

  const workflowsDir = path.join(process.cwd(), '.github', 'workflows')
  fs.mkdirSync(workflowsDir, { recursive: true })

  const workflowFile = path.join(workflowsDir, 'costrict.yml')
  fs.writeFileSync(workflowFile, fs.readFileSync(githubWorkflowTemplate, 'utf8'), 'utf8')

  logger.info(`Created GitHub Actions workflow at: ${workflowFile}`)

  if (apiKey) {
    try {
      execSync('gh auth status || gh auth login', { stdio: 'inherit' })
      execSync(`gh secret set OPENAI_API_KEY --body=${String(apiKey)}`)
      logger.info(
        'Successfully added the OPENAI_API_KEY secret to your GitHub repository.'
      )
    } catch (error) {
      logger.error(
        "It seems that the GitHub CLI is not installed or there was an error during authentication. Don't forget to add the OPENAI_API_KEY to the repo settings/Environment/Actions/Repository Secrets manually."
      )
    }
  }
}
