import type { Tool } from 'ai'
import { bashTool } from './bash'
import { fetchTool } from './fetch'
import { globTool } from './glob'
import { grepTool } from './grep'
import { lsTool } from './ls'
import { planTool } from './plan'
import { readFileTool } from './readFile'
import { reportBugTool } from './reportBug'
import {
  type SandboxExecConfirm,
  type SandboxExecOnEvent,
  createSandboxExecTool,
} from './sandboxExec'
import { thinkingTool } from './thinking'

export const getBaseTools = (
  options: {
    sandboxConfirm?: SandboxExecConfirm
    sandboxOnEvent?: SandboxExecOnEvent
  } = {}
): Record<string, Tool> => ({
  read_file: readFileTool,
  fetch: fetchTool,
  glob: globTool,
  grep: grepTool,
  ls: lsTool,
  plan: planTool,
  bash: bashTool,
  sandbox_exec: createSandboxExecTool(options.sandboxConfirm, options.sandboxOnEvent),
  thinking: thinkingTool,
  report_bug: reportBugTool,
})

import type { LanguageModelV1 } from 'ai'
import type { PlatformProvider } from '../../platform/provider'
import type { MCPClientManager } from '../mcp/client'
import { createReadDiffTool } from './readDiff'
import { createSubAgentTool } from './subAgent'
import { createSubmitSummaryTool } from './submitSummary'
import { createSuggestChangesTool } from './suggestChanges'

export interface GetAllToolsOptions {
  platformProvider?: PlatformProvider
  model?: LanguageModelV1
  mcpClientManager?: MCPClientManager
  includeSubAgent?: boolean
  maxSteps?: number
  sandboxConfirm?: SandboxExecConfirm
  sandboxOnEvent?: SandboxExecOnEvent
}

export const getAllTools = async (
  options: GetAllToolsOptions = {}
): Promise<Record<string, Tool>> => {
  const tools = {
    ...getBaseTools({
      sandboxConfirm: options.sandboxConfirm,
      sandboxOnEvent: options.sandboxOnEvent,
    }),
  }

  if (options.platformProvider) {
    tools.read_diff = createReadDiffTool(options.platformProvider)
    tools.suggest_change = createSuggestChangesTool(options.platformProvider)
    tools.submit_summary = createSubmitSummaryTool(options.platformProvider)
  }

  if (options.model && options.includeSubAgent && options.maxSteps) {
    tools.spawn_subagent = createSubAgentTool(options.model, options.maxSteps, {
      sandboxConfirm: options.sandboxConfirm,
      sandboxOnEvent: options.sandboxOnEvent,
      platformProvider: options.platformProvider,
    })
  }

  if (options.mcpClientManager) {
    const mcpTools: Record<string, Tool> = {}
    for (const [serverName, tools] of Object.entries(
      await options.mcpClientManager.getTools()
    )) {
      for (const [toolName, tool] of Object.entries(tools)) {
        mcpTools[`${serverName}-${toolName}`] = tool
      }
    }
    Object.assign(tools, mcpTools)
  }

  return tools
}

export {
  bashTool,
  thinkingTool,
  fetchTool,
  globTool,
  grepTool,
  lsTool,
  planTool,
  createReadDiffTool,
  readFileTool,
  createSandboxExecTool,
  createSubmitSummaryTool,
  createSuggestChangesTool,
  createSubAgentTool,
}
