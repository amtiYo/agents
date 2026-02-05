import { describe, expect, it } from 'vitest'
import { inferSecretArgs, splitServerSecrets } from '../src/core/mcpSecrets.js'

describe('mcp secrets', () => {
  it('moves secret env/header values to local override and keeps placeholders in public config', () => {
    const split = splitServerSecrets({
      name: 'context7',
      server: {
        transport: 'http',
        url: 'https://mcp.context7.com/mcp',
        headers: {
          Authorization: 'Bearer real-token'
        },
        env: {
          CONTEXT7_API_KEY: 'real-key',
          FASTMCP_LOG_LEVEL: 'ERROR'
        }
      },
      secretEnv: {
        CONTEXT7_API_KEY: 'real-key'
      },
      secretHeaders: {
        Authorization: 'Bearer real-token'
      }
    })

    expect(split.publicServer.env?.CONTEXT7_API_KEY).toMatch(/^\$\{[A-Z0-9_]+\}$/)
    expect(split.publicServer.headers?.Authorization).toMatch(/^\$\{[A-Z0-9_]+\}$/)
    expect(split.publicServer.env?.FASTMCP_LOG_LEVEL).toBe('ERROR')

    expect(split.localOverride.env?.CONTEXT7_API_KEY).toBe('real-key')
    expect(split.localOverride.headers?.Authorization).toBe('Bearer real-token')
  })

  it('supports secret args via index replacement', () => {
    const args = ['-y', '@upstash/context7-mcp', '--api-key', 'my-secret']
    const inferred = inferSecretArgs(args)
    expect(inferred).toEqual([3])

    const split = splitServerSecrets({
      name: 'context7',
      server: {
        transport: 'stdio',
        command: 'npx',
        args
      },
      secretArgs: inferred.map((index) => ({ index, value: args[index] }))
    })

    expect(split.publicServer.args?.[3]).toMatch(/^\$\{[A-Z0-9_]+\}$/)
    expect(split.localOverride.args?.[3]).toBe('my-secret')
    expect(split.localOverride.args?.[2]).toBe('--api-key')
  })

  it('can placeholderize secrets without writing local values', () => {
    const split = splitServerSecrets({
      name: 'my-repo',
      server: {
        transport: 'stdio',
        command: 'node',
        args: ['/absolute/path/to/generated/server.mjs', '--token', 'ghp_xxxx'],
        env: {
          GITHUB_TOKEN: 'ghp_xxxx'
        }
      },
      secretEnvKeys: ['GITHUB_TOKEN'],
      secretArgIndexes: [2]
    })

    expect(split.publicServer.env?.GITHUB_TOKEN).toBe('${GITHUB_TOKEN}')
    expect(split.publicServer.args?.[2]).toMatch(/^\$\{[A-Z0-9_]+\}$/)
    expect(split.localOverride.env).toBeUndefined()
    expect(split.localOverride.args).toBeUndefined()
  })
})
