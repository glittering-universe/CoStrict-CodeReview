import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type SandboxExecStreamEvent, createSandboxExecTool } from '../sandboxExec'

describe('sandboxExecTool', () => {
  const toolOptions = (toolCallId: string) => ({
    toolCallId,
    messages: [],
  })

  test('executes command in a sandbox copy', async () => {
    const sandboxExecTool = createSandboxExecTool(async () => ({ approved: true }))
    const repoRoot = process.cwd()
    const tempDir = await mkdtemp(path.join(repoRoot, 'sandbox-exec-test-'))
    const fixturePath = path.join(tempDir, 'sample.txt')

    await writeFile(fixturePath, 'sandbox-ok', 'utf8')

    try {
      const output = await sandboxExecTool.execute(
        {
          command: 'cat sample.txt',
          cwd: tempDir,
          timeout: 5000,
          preserveSandbox: false,
        },
        toolOptions('sandbox-exec-test')
      )

      expect(output).toContain('Sandbox root:')
      expect(output).toContain('sandbox-ok')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('blocks dangerous commands', async () => {
    const sandboxExecTool = createSandboxExecTool(async () => ({ approved: true }))
    const output = await sandboxExecTool.execute(
      {
        command: 'rm -rf /',
        cwd: '.',
        timeout: 1000,
        preserveSandbox: false,
      },
      toolOptions('sandbox-exec-dangerous')
    )

    expect(output).toContain('Potentially dangerous command')
  })

  test('emits sandbox run stream events', async () => {
    const events: SandboxExecStreamEvent[] = []
    const sandboxExecTool = createSandboxExecTool(
      async () => ({ approved: true }),
      (event) => {
        events.push(event)
      }
    )

    const repoRoot = process.cwd()
    const tempDir = await mkdtemp(path.join(repoRoot, 'sandbox-exec-stream-test-'))
    const fixturePath = path.join(tempDir, 'sample.txt')

    await writeFile(fixturePath, 'sandbox-stream', 'utf8')

    try {
      await sandboxExecTool.execute(
        {
          command: 'cat sample.txt',
          cwd: tempDir,
          timeout: 5000,
          preserveSandbox: false,
        },
        toolOptions('sandbox-exec-stream')
      )

      expect(events.some((event) => event.type === 'sandbox_run_start')).toBe(true)
      expect(
        events.some(
          (event) =>
            event.type === 'sandbox_run_output' &&
            event.stream === 'stdout' &&
            event.text.includes('sandbox-stream')
        )
      ).toBe(true)
      expect(events[events.length - 1]?.type).toBe('sandbox_run_end')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
