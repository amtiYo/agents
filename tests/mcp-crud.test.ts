import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { loadMcpState, removeMcpServer, upsertMcpServers } from '../src/core/mcpCrud.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function setupProject(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-crud-'))
  tempDirs.push(projectRoot)
  await saveAgentsConfig(projectRoot, createDefaultAgentsConfig())
  await writeFile(path.join(projectRoot, '.agents', 'local.json'), JSON.stringify({ mcpServers: {} }, null, 2))
  return projectRoot
}

describe('mcp CRUD', () => {
  it('adds and replaces servers with local overrides', async () => {
    const projectRoot = await setupProject()

    await upsertMcpServers({
      projectRoot,
      replace: false,
      updates: [
        {
          name: 'context7',
          server: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp', '--api-key', '${CONTEXT7_API_KEY}']
          },
          localOverride: {
            args: ['-y', '@upstash/context7-mcp', '--api-key', 'secret']
          }
        }
      ]
    })

    const stateAfterAdd = await loadMcpState(projectRoot)
    expect(stateAfterAdd.config.mcp.servers.context7).toBeDefined()
    expect(stateAfterAdd.local.mcpServers.context7?.args?.[3]).toBe('secret')

    await expect(
      upsertMcpServers({
        projectRoot,
        replace: false,
        updates: [
          {
            name: 'context7',
            server: {
              transport: 'stdio',
              command: 'npx'
            }
          }
        ]
      }),
    ).rejects.toThrow(/already exists/)

    await upsertMcpServers({
      projectRoot,
      replace: true,
      updates: [
        {
          name: 'context7',
          server: {
            transport: 'http',
            url: 'https://mcp.context7.com/mcp'
          }
        }
      ]
    })

    const stateAfterReplace = await loadMcpState(projectRoot)
    expect(stateAfterReplace.config.mcp.servers.context7.transport).toBe('http')
    expect(stateAfterReplace.local.mcpServers.context7).toBeUndefined()
  })

  it('removes servers from config and local overrides', async () => {
    const projectRoot = await setupProject()

    await upsertMcpServers({
      projectRoot,
      replace: false,
      updates: [
        {
          name: 'context7',
          server: {
            transport: 'stdio',
            command: 'npx'
          },
          localOverride: {
            env: {
              CONTEXT7_API_KEY: 'secret'
            }
          }
        }
      ]
    })

    const removed = await removeMcpServer({
      projectRoot,
      name: 'context7',
      ignoreMissing: false
    })
    expect(removed).toBe(true)

    const state = await loadMcpState(projectRoot)
    expect(state.config.mcp.servers.context7).toBeUndefined()
    expect(state.local.mcpServers.context7).toBeUndefined()
  })
})
