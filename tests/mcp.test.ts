import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { loadResolvedRegistry } from '../src/core/mcp.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('loadResolvedRegistry', () => {
  it('merges local override and resolves ${PROJECT_ROOT}', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-'))
    tempDirs.push(dir)

    const mcpDir = path.join(dir, '.agents', 'mcp')
    await mkdir(mcpDir, { recursive: true })

    await writeFile(
      path.join(mcpDir, 'registry.json'),
      JSON.stringify(
        {
          mcpServers: {
            filesystem: {
              transport: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '${PROJECT_ROOT}'],
              targets: ['codex'],
              enabled: true
            }
          }
        },
        null,
        2,
      ),
    )

    await writeFile(
      path.join(mcpDir, 'local.json'),
      JSON.stringify(
        {
          mcpServers: {
            filesystem: {
              args: ['-y', '@modelcontextprotocol/server-filesystem', '${PROJECT_ROOT}/subdir']
            }
          }
        },
        null,
        2,
      ),
    )

    const resolved = await loadResolvedRegistry(dir)
    expect(resolved.serversByTarget.codex).toHaveLength(1)
    expect(resolved.serversByTarget.codex[0]?.args?.at(-1)).toBe(`${dir}/subdir`)
  })

  it('skips servers with missing required env', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-'))
    tempDirs.push(dir)

    const mcpDir = path.join(dir, '.agents', 'mcp')
    await mkdir(mcpDir, { recursive: true })

    await writeFile(
      path.join(mcpDir, 'registry.json'),
      JSON.stringify(
        {
          mcpServers: {
            context7: {
              transport: 'stdio',
              command: 'npx',
              args: ['-y', '@upstash/context7-mcp', '--api-key', '${CONTEXT7_API_KEY}'],
              requiredEnv: ['CONTEXT7_API_KEY'],
              targets: ['codex', 'gemini'],
              enabled: true
            }
          }
        },
        null,
        2,
      ),
    )

    await writeFile(path.join(mcpDir, 'local.json'), JSON.stringify({ mcpServers: {} }, null, 2))

    const prev = process.env.CONTEXT7_API_KEY
    delete process.env.CONTEXT7_API_KEY

    const resolved = await loadResolvedRegistry(dir)
    expect(resolved.serversByTarget.codex).toHaveLength(0)
    expect(resolved.missingRequiredEnv.join(' ')).toContain('CONTEXT7_API_KEY')

    if (prev) {
      process.env.CONTEXT7_API_KEY = prev
    }
  })
})
