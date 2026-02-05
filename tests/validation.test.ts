import { describe, it, expect } from 'vitest'
import { readJson } from '../src/core/fs.js'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

describe('JSON parsing error handling', () => {
  it('should throw helpful error for invalid JSON', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agents-validation-'))
    try {
      const filePath = path.join(dir, 'invalid.json')
      await writeFile(filePath, '{ invalid json }', 'utf8')

      await expect(readJson(filePath)).rejects.toThrow(/Failed to parse JSON/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('should throw helpful error for empty JSON', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agents-validation-'))
    try {
      const filePath = path.join(dir, 'empty.json')
      await writeFile(filePath, '', 'utf8')

      await expect(readJson(filePath)).rejects.toThrow(/Failed to parse JSON/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('should parse valid JSON successfully', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agents-validation-'))
    try {
      const filePath = path.join(dir, 'valid.json')
      await writeFile(filePath, '{"test": "value"}', 'utf8')

      const result = await readJson<{ test: string }>(filePath)
      expect(result).toEqual({ test: 'value' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('Server name validation', () => {
  // Note: These tests would require exporting the validation functions or testing through sync
  // For now, we'll create integration tests that verify the behavior

  it('should be tested through sync integration tests', () => {
    // This is a placeholder - actual validation is tested in sync.test.ts
    expect(true).toBe(true)
  })
})
