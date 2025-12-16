import { existsSync } from 'node:fs'
import dotenv from 'dotenv'
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { getFilesWithChanges } from './common/git/getFilesWithChanges'
import { MCPClientManager } from './common/llm/mcp/client'
import { createModel } from './common/llm/models'
import { getAllTools } from './common/llm/tools'
import { getPlatformProvider } from './common/platform/factory'
import { logger } from './common/utils/logger'
import { reviewAgent } from './review/agent/generate'
import { constructPrompt } from './review/prompt'
import { filterFiles } from './review/utils/filterFiles'

dotenv.config()

const app = new Hono()

app.use('/*', cors())

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/review', async (c) => {
  const body = await c.req.json()
  const {
    modelString = 'openai:gpt-4o',
    maxSteps = 25,
    reviewLanguage = 'English',
    apiKey,
    baseUrl,
  } = body
  const trimmedBaseUrl =
    typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/$/, '') : undefined
  const trimmedApiKey = typeof apiKey === 'string' ? apiKey.trim() : undefined
  const effectiveBaseUrl = trimmedBaseUrl || process.env.OPENAI_API_BASE
  const effectiveApiKey = trimmedApiKey || process.env.OPENAI_API_KEY

  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'status', message: 'Initializing review...' }),
      })

      // 1. Get Files
      console.log('Getting platform provider...')
      const platformProvider = await getPlatformProvider('local')
      console.log('Getting files with changes...')
      const files = await getFilesWithChanges('local')
      console.log(`Found ${files.length} files`)

      if (files.length === 0) {
        console.log('No files found, returning error')
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'error',
            message: 'No changed files found. Please stage some changes.',
          }),
        })
        return
      }

      await stream.writeSSE({
        data: JSON.stringify({
          type: 'files',
          files: files.map((f) => f.fileName),
        }),
      })

      // 2. Filter Files
      const filteredFiles = filterFiles(files, []) // TODO: Add ignore support

      // 3. Construct Prompt
      const prompt = await constructPrompt(filteredFiles, reviewLanguage)

      // 4. Setup Model & Tools
      const model = createModel(modelString, {
        baseURL: effectiveBaseUrl,
        apiKey: effectiveApiKey,
      })

      const clients = new MCPClientManager()
      await clients.loadConfig()
      await clients.startClients()

      const tools = await getAllTools({
        platformProvider,
        model,
        mcpClientManager: clients,
        includeSubAgent: true,
        maxSteps,
      })

      // 5. Run Agent
      await stream.writeSSE({
        data: JSON.stringify({ type: 'status', message: 'Agent started...' }),
      })

      const result = await reviewAgent(
        prompt,
        model,
        maxSteps,
        tools,
        () => {
          // Summary submitted callback
        },
        async (step) => {
          // Stream step
          await stream.writeSSE({
            data: JSON.stringify({
              type: 'step',
              step: {
                toolCalls: step.toolCalls,
                text: step.text,
                usage: step.usage,
              },
            }),
          })
        }
      )

      // Final result
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'complete',
          result: result.text,
        }),
      })

      await clients.closeClients()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cause =
        error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined
      const causeMessage =
        cause instanceof Error ? cause.message : cause ? String(cause) : undefined
      const fullMessage = [
        message,
        causeMessage ? `Cause: ${causeMessage}` : null,
        effectiveBaseUrl ? `Base URL: ${effectiveBaseUrl}` : null,
        modelString ? `Model: ${modelString}` : null,
      ]
        .filter(Boolean)
        .join(' | ')

      logger.error(`Review failed: ${fullMessage}`)
      if (error instanceof Error && error.stack) {
        logger.debug(error.stack)
      }
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          message: fullMessage,
        }),
      })
    }
  })
})

// Serve static files (Frontend)
// Prefer packaged output under dist/web; fall back to web/dist for local development.
const staticRoot = existsSync('./dist/web/index.html')
  ? './dist/web'
  : existsSync('./web/dist/index.html')
    ? './web/dist'
    : null

if (staticRoot) {
  const serveIndex = serveStatic({ root: staticRoot, path: 'index.html' })
  app.get('/', serveIndex)
  app.use('/*', serveStatic({ root: staticRoot }))
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next()
    return serveIndex(c, next)
  })
} else {
  logger.warn('No frontend build found (expected ./dist/web or ./web/dist).')
  app.get('/', (c) =>
    c.html(
      `<html><body style="font-family: ui-sans-serif, system-ui; padding: 24px; background: #05060a; color: #e2e8f0;">
        <h1 style="margin: 0 0 12px;">Frontend not built</h1>
        <p style="margin: 0 0 16px; color: #94a3b8;">Run <code>cd web &amp;&amp; bun run dev</code> for development, or <code>cd web &amp;&amp; bun run build</code> then restart this server.</p>
      </body></html>`
    )
  )
}

export default {
  port: 3000,
  fetch: app.fetch,
}
