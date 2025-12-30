import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Tool, experimental_createMCPClient } from 'ai'
import { Experimental_StdioMCPTransport as StdioMCPTransport } from 'ai/mcp-stdio'
import { getGitRoot } from '../../git/getChangedFilesNames'
import { logger } from '../../utils/logger'

interface MCPClient {
  tools: () => Promise<Record<string, Tool>>
  close: () => Promise<void>
}

interface MCPServerConfig {
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
}

interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
}

const stripJsonComments = (input: string): string => {
  let output = ''
  let inString = false
  let stringQuote: '"' | "'" | null = null
  let escaped = false

  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    const next = input[index + 1]

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (stringQuote && char === stringQuote) {
        inString = false
        stringQuote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      stringQuote = char
      output += char
      continue
    }

    if (char === '/' && next === '/') {
      while (index < input.length && input[index] !== '\n') index++
      output += '\n'
      continue
    }

    if (char === '/' && next === '*') {
      index += 2
      while (index < input.length) {
        if (input[index] === '*' && input[index + 1] === '/') {
          index++
          break
        }
        index++
      }
      continue
    }

    output += char
  }

  return output
}

const commandExistsInPath = (command: string): boolean => {
  if (!command) return false
  if (command.includes('/') || command.includes('\\')) return existsSync(command)

  const pathVar = process.env.PATH ?? ''
  const delimiter = process.platform === 'win32' ? ';' : ':'
  const dirs = pathVar.split(delimiter).filter(Boolean)

  if (process.platform === 'win32') {
    const extensions = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .filter(Boolean)
    for (const dir of dirs) {
      for (const ext of extensions) {
        if (existsSync(join(dir, `${command}${ext}`))) return true
      }
    }
    return false
  }

  for (const dir of dirs) {
    if (existsSync(join(dir, command))) return true
  }

  return false
}

const normalizeNpxArgsForBunx = (args: string[] | undefined): string[] | undefined => {
  if (!args?.length) return args
  return args.filter((arg) => arg !== '-y' && arg !== '--yes')
}

export class MCPClientManager {
  private clients: Record<string, MCPClient | null> = {}
  private config: MCPConfig | null = null

  async loadConfig(): Promise<void> {
    try {
      const workspacePath = await getGitRoot()
      const currentPath = process.cwd()
      const config: MCPConfig = { mcpServers: {} }
      let loadedAnyConfig = false

      // Search paths in order: current working directory, then git root
      const searchPaths = [currentPath, workspacePath]

      for (const basePath of searchPaths) {
        // Try to load from .costrict/mcp.json
        const costrictConfigPath = join(basePath, '.costrict', 'mcp.json')
        if (existsSync(costrictConfigPath)) {
          try {
            const costrictConfigContent = await readFile(costrictConfigPath, 'utf-8')
            const normalized = stripJsonComments(costrictConfigContent).trim()
            if (!normalized) {
              logger.info(`Loaded empty MCP config from ${costrictConfigPath}`)
              loadedAnyConfig = true
            } else {
              const costrictConfig = JSON.parse(normalized) as MCPConfig
              config.mcpServers = { ...config.mcpServers, ...costrictConfig.mcpServers }
              loadedAnyConfig = true
              logger.info(`Loaded MCP config from ${costrictConfigPath}`)
            }
          } catch (error) {
            logger.warn(`Found .costrict/mcp.json but failed to read it: ${error}`)
          }
        }

        // Try to load from .cursor/mcp.json
        const cursorConfigPath = join(basePath, '.cursor', 'mcp.json')
        if (existsSync(cursorConfigPath)) {
          try {
            const cursorConfigContent = await readFile(cursorConfigPath, 'utf-8')
            const normalized = stripJsonComments(cursorConfigContent).trim()
            if (!normalized) {
              logger.info(`Loaded empty MCP config from ${cursorConfigPath}`)
              loadedAnyConfig = true
            } else {
              const cursorConfig = JSON.parse(normalized) as MCPConfig
              config.mcpServers = { ...config.mcpServers, ...cursorConfig.mcpServers }
              loadedAnyConfig = true
              logger.info(`Loaded MCP config from ${cursorConfigPath}`)
            }
          } catch (error) {
            logger.warn(`Found .cursor/mcp.json but failed to read it: ${error}`)
          }
        }
      }

      // If no configs were found, set config to null
      if (!loadedAnyConfig) {
        logger.warn(
          'No MCP configuration found in .costrict/mcp.json, .cursor/mcp.json, or git root'
        )
        this.config = null
        return
      }

      this.config = config
    } catch (error) {
      logger.error(`Failed to load MCP config: ${error}`)
      this.config = null
    }
  }

  async startClients(): Promise<void> {
    if (!this.config) {
      logger.warn('Cannot start clients: MCP config not loaded')
      return
    }

    for (const [serverName, serverConfig] of Object.entries(this.config.mcpServers)) {
      try {
        if (serverConfig.command) {
          let command = serverConfig.command
          let args = serverConfig.args

          if (
            command === 'npx' &&
            !commandExistsInPath(command) &&
            commandExistsInPath('bunx')
          ) {
            logger.warn(
              `MCP server "${serverName}" is configured to use "npx" but it is not available; falling back to "bunx".`
            )
            command = 'bunx'
            args = normalizeNpxArgsForBunx(args)
          }

          // Use StdioMCPTransport for command-based configuration
          const transport = new StdioMCPTransport({
            command,
            args,
          })

          this.clients[serverName] = await experimental_createMCPClient({
            transport,
          })
          logger.info(`Started MCP client for ${serverName}`)
        } else if (serverConfig.url) {
          // Use SSE transport directly for URL-based configuration
          this.clients[serverName] = await experimental_createMCPClient({
            transport: {
              type: 'sse',
              url: serverConfig.url,
              headers: serverConfig.headers,
            },
          })
        } else {
          logger.error(`Invalid MCP server configuration for ${serverName}`)
          this.clients[serverName] = null
        }
      } catch (error) {
        logger.error(`Failed to create MCP client for ${serverName}: ${error}`)
        this.clients[serverName] = null
      }
    }
  }

  async getTools(): Promise<Record<string, Record<string, Tool>>> {
    const allTools: Record<string, Record<string, Tool>> = {}

    for (const [serverName, client] of Object.entries(this.clients)) {
      if (client) {
        try {
          allTools[serverName] = await client.tools()
        } catch (error) {
          logger.error(`Failed to get tools from ${serverName}: ${error}`)
          allTools[serverName] = {}
        }
      }
    }

    return allTools
  }

  async closeClients(): Promise<void> {
    for (const [serverName, client] of Object.entries(this.clients)) {
      if (client) {
        try {
          await client.close()
        } catch (error) {
          logger.error(`Failed to close MCP client ${serverName}: ${error}`)
        }
      }
    }

    this.clients = {}
  }
}
