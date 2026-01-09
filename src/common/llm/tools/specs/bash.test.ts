import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { withWorkspaceRoot } from '../../../git/getChangedFilesNames'
import { bashTool } from '../bash'

describe('bashTool', () => {
  test('resolves cwd relative to the workspace root', async () => {
    const repoRoot = process.cwd()
    const workspaceRoot = await mkdtemp(path.join(repoRoot, 'bash-tool-test-'))

    try {
      await writeFile(path.join(workspaceRoot, 'hello.txt'), 'hi\n', 'utf8')

      const output = await withWorkspaceRoot(workspaceRoot, async () =>
        bashTool.execute({ command: 'ls', cwd: '.', timeout: 5000 })
      )

      expect(output).toContain('hello.txt')
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})
