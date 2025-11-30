import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import { streamSSE } from 'hono/streaming'
import { getFilesWithChanges } from './common/git/getFilesWithChanges'
import { createModel } from './common/llm/models'
import { getPlatformProvider } from './common/platform/factory'
import { logger } from './common/utils/logger'
import { constructPrompt } from './review/prompt'
import { filterFiles } from './review/utils/filterFiles'
import { reviewAgent } from './review/agent/generate'
import { getAllTools } from './common/llm/tools'
import { MCPClientManager } from './common/llm/mcp/client'
import { accumulateTokenUsage, formatToolUsage } from './common/formatting/usage'
import type { TokenUsage, ToolCall } from './review/types'

const app = new Hono()

app.use('/*', cors())

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/review', async (c) => {
    const body = await c.req.json()
    const { modelString = 'openai:gpt-4o', maxSteps = 25, reviewLanguage = 'English' } = body

    return streamSSE(c, async (stream) => {
        try {
            await stream.writeSSE({ data: JSON.stringify({ type: 'status', message: 'Initializing review...' }) })

            // 1. Get Files
            console.log('Getting platform provider...')
            const platformProvider = await getPlatformProvider('local')
            console.log('Getting files with changes...')
            const files = await getFilesWithChanges('local')
            console.log(`Found ${files.length} files`)

            if (files.length === 0) {
                console.log('No files found, returning error')
                await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: 'No changed files found. Please stage some changes.' }) })
                return
            }

            await stream.writeSSE({
                data: JSON.stringify({
                    type: 'files',
                    files: files.map(f => f.fileName)
                })
            })

            // 2. Filter Files
            const filteredFiles = filterFiles(files, []) // TODO: Add ignore support

            // 3. Construct Prompt
            const prompt = await constructPrompt(filteredFiles, reviewLanguage)

            // 4. Setup Model & Tools
            const model = createModel(modelString, {
                baseURL: process.env.OPENAI_API_BASE
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
            let tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            const attempt = 1

            await stream.writeSSE({ data: JSON.stringify({ type: 'status', message: 'Agent started...' }) })

            const result = await reviewAgent(prompt, model, maxSteps, tools,
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
                                usage: step.usage
                            }
                        })
                    })
                }
            )

            // Final result
            await stream.writeSSE({
                data: JSON.stringify({
                    type: 'complete',
                    result: result.text
                })
            })

            await clients.closeClients()

        } catch (error) {
            logger.error('Review failed', error)
            await stream.writeSSE({
                data: JSON.stringify({
                    type: 'error',
                    message: error instanceof Error ? error.message : String(error)
                })
            })
        }
    })
})

// Serve static files (Frontend)
app.use('/*', serveStatic({ root: './dist/web' }))

export default {
    port: 3000,
    fetch: app.fetch,
}
