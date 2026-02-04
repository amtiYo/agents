import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadResolvedRegistry } from '../src/core/mcp.js'
import { MCP_SELECTION_SCHEMA_VERSION } from '../src/types.js'

const tempDirs: string[] = []
let previousCatalogPath: string | undefined

beforeEach(() => {
  previousCatalogPath = process.env.AGENTS_CATALOG_PATH
})

afterEach(async () => {
  if (previousCatalogPath === undefined) {
    delete process.env.AGENTS_CATALOG_PATH
  } else {
    process.env.AGENTS_CATALOG_PATH = previousCatalogPath
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('loadResolvedRegistry', () => {
  it('resolves selected MCP servers from catalog + local override', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-'))
    tempDirs.push(dir)

    const catalogPath = path.join(dir, 'catalog.json')
    process.env.AGENTS_CATALOG_PATH = catalogPath

    await writeFile(
      catalogPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          mcpPresets: [{ id: 'safe-core', label: 'Safe core', description: 'core', serverIds: ['filesystem'] }],
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
          },
          skillPacks: [],
          skills: {}
        },
        null,
        2,
      ),
    )

    const mcpDir = path.join(dir, '.agents', 'mcp')
    await mkdir(mcpDir, { recursive: true })

    await writeFile(
      path.join(mcpDir, 'selection.json'),
      JSON.stringify(
        {
          schemaVersion: MCP_SELECTION_SCHEMA_VERSION,
          preset: 'safe-core',
          selectedMcpServers: ['filesystem']
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

  it('skips selected server when required env is missing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-'))
    tempDirs.push(dir)

    const catalogPath = path.join(dir, 'catalog.json')
    process.env.AGENTS_CATALOG_PATH = catalogPath

    await writeFile(
      catalogPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          mcpPresets: [{ id: 'dev-full', label: 'Dev full', description: 'full', serverIds: ['context7'] }],
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
          },
          skillPacks: [],
          skills: {}
        },
        null,
        2,
      ),
    )

    const mcpDir = path.join(dir, '.agents', 'mcp')
    await mkdir(mcpDir, { recursive: true })

    await writeFile(
      path.join(mcpDir, 'selection.json'),
      JSON.stringify(
        {
          schemaVersion: MCP_SELECTION_SCHEMA_VERSION,
          preset: 'dev-full',
          selectedMcpServers: ['context7']
        },
        null,
        2,
      ),
    )

    await writeFile(path.join(mcpDir, 'local.json'), JSON.stringify({ mcpServers: {} }, null, 2))

    const previous = process.env.CONTEXT7_API_KEY
    delete process.env.CONTEXT7_API_KEY

    const resolved = await loadResolvedRegistry(dir)
    expect(resolved.serversByTarget.codex).toHaveLength(0)
    expect(resolved.missingRequiredEnv.join(' ')).toContain('CONTEXT7_API_KEY')

    if (previous) process.env.CONTEXT7_API_KEY = previous
  })
})
