import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createSandboxExecTool } from '../sandboxExec'

describe('sandboxExecTool', () => {
  test('executes command in a sandbox copy', async () => {
    const sandboxExecTool = createSandboxExecTool(async () => ({ approved: true }))
    const repoRoot = process.cwd()
    const tempDir = await mkdtemp(path.join(repoRoot, 'sandbox-exec-test-'))
    const fixturePath = path.join(tempDir, 'sample.txt')

    await writeFile(fixturePath, 'sandbox-ok', 'utf8')

    try {
      const output = await sandboxExecTool.execute({
        command: 'cat sample.txt',
        cwd: tempDir,
        timeout: 5000,
        preserveSandbox: false,
      })

      expect(output).toContain('Sandbox root:')
      expect(output).toContain('sandbox-ok')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('blocks dangerous commands', async () => {
    const sandboxExecTool = createSandboxExecTool(async () => ({ approved: true }))
    const output = await sandboxExecTool.execute({
      command: 'rm -rf /',
      cwd: '.',
      timeout: 1000,
      preserveSandbox: false,
    })

    expect(output).toContain('Potentially dangerous command')
  })
})
