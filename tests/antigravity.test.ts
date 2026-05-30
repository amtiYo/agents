import { describe, expect, it } from 'vitest'
import { normalizeAntigravityMcpPayload } from '../src/core/antigravity.js'

describe('antigravity helpers', () => {
  it('normalizes legacy payloads without preserving servers or inputs', () => {
    const normalized = normalizeAntigravityMcpPayload({
      servers: {
        filesystem: { command: 'npx' }
      },
      inputs: [
        {
          id: 'legacy-token',
          type: 'promptString'
        }
      ],
      theme: 'dark'
    })

    expect(normalized).toEqual({
      mcpServers: {
        filesystem: { command: 'npx' }
      },
      theme: 'dark'
    })
  })
})
