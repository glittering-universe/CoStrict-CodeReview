import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { grepTool } from '../grep'

describe('grepTool', () => {
  test('searches a single file when path points to a file', async () => {
    const repoRoot = process.cwd()
    const tempDir = await mkdtemp(path.join(repoRoot, 'grep-tool-test-'))
    const filePath = path.join(tempDir, 'sample.ts')

    await writeFile(
      filePath,
      'const resolveSsePingIntervalMs = () => 5000\nconst other = 1\n',
      'utf8'
    )

    try {
      const output = await grepTool.execute(
        {
          pattern: 'resolveSsePingIntervalMs',
          path: filePath,
          glob: '**/*.*',
          ignoreCase: false,
          maxResults: 10,
        },
        { toolCallId: 'grep-test', messages: [] }
      )

      expect(output).toContain('Found 1 matches')
      expect(output).toContain('resolveSsePingIntervalMs')
      expect(output).not.toContain('in 0 files')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('searches recursively when path points to a directory', async () => {
    const repoRoot = process.cwd()
    const tempDir = await mkdtemp(path.join(repoRoot, 'grep-tool-test-dir-'))
    const filePath = path.join(tempDir, 'nested.ts')

    await writeFile(filePath, 'const target = 123\n', 'utf8')

    try {
      const output = await grepTool.execute(
        {
          pattern: 'target',
          path: tempDir,
          glob: '**/*.ts',
          ignoreCase: false,
          maxResults: 10,
        },
        { toolCallId: 'grep-test-dir', messages: [] }
      )

      expect(output).toContain('Found 1 matches')
      expect(output).toContain('nested.ts')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
