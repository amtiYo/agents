import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { loadResolvedRegistry } from '../src/core/mcp.js'
import { createDefaultAgentsConfig } from '../src/core/config.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('loadResolvedRegistry', () => {
  it('resolves MCP servers from agents config + local override', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-'))
    tempDirs.push(dir)

    await mkdir(path.join(dir, '.agents'), { recursive: true })

    const config = createDefaultAgentsConfig({
      mcpServers: {
        filesystem: {
          label: 'Filesystem',
          description: 'fs',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '${PROJECT_ROOT}'],
          targets: ['codex'],
          enabled: true
        }
      }
    })

    await writeFile(path.join(dir, '.agents', 'agents.json'), `${JSON.stringify(config, null, 2)}\n`)
    await writeFile(
      path.join(dir, '.agents', 'local.json'),
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

  it('skips server when required env is missing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-'))
    tempDirs.push(dir)

    await mkdir(path.join(dir, '.agents'), { recursive: true })

    const config = createDefaultAgentsConfig({
      mcpServers: {
        context7: {
          label: 'Context7',
          description: 'docs',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp', '--api-key', '${CONTEXT7_API_KEY}'],
          requiredEnv: ['CONTEXT7_API_KEY'],
          targets: ['codex'],
          enabled: true
        }
      }
    })

    await writeFile(path.join(dir, '.agents', 'agents.json'), `${JSON.stringify(config, null, 2)}\n`)
    await writeFile(path.join(dir, '.agents', 'local.json'), JSON.stringify({ mcpServers: {} }, null, 2))

    const previous = process.env.CONTEXT7_API_KEY
    delete process.env.CONTEXT7_API_KEY

    const resolved = await loadResolvedRegistry(dir)
    expect(resolved.serversByTarget.codex).toHaveLength(0)
    expect(resolved.missingRequiredEnv.join(' ')).toContain('CONTEXT7_API_KEY')

    if (previous) process.env.CONTEXT7_API_KEY = previous
  })
})
