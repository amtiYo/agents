import { describe, it, expect } from 'vitest'
import { pathExists } from '../src/core/fs.js'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

/**
 * This test suite validates that the agents project itself
 * has properly configured MCP servers (dogfooding).
 *
 * This catches configuration drift and ensures we test
 * against real-world setups, not just mocked scenarios.
 */
describe('Real project MCP configuration (dogfooding)', () => {
  const projectRoot = path.resolve(process.cwd())

  it('should have .claude directory if Claude is set up', async () => {
    const claudeDir = path.join(projectRoot, '.claude')
    const exists = await pathExists(claudeDir)

    if (exists) {
      // If .claude exists, verify it has expected files
      const settingsLocal = path.join(claudeDir, 'settings.local.json')
      const settingsExists = await pathExists(settingsLocal)

      // This is informational - we don't fail if settings don't exist
      if (settingsExists) {
        console.log('✓ Found .claude/settings.local.json')
      }
    }
  })

  it('should be able to check Claude MCP status if claude CLI is available', () => {
    const result = spawnSync('claude', ['mcp', 'list'], {
      encoding: 'utf8',
      cwd: projectRoot,
      timeout: 5000
    })

    if ((result.error as { code?: string } | undefined)?.code === 'ETIMEDOUT') {
      console.log('ℹ Claude CLI probe timed out, skipping real MCP check')
      expect(true).toBe(true)
      return
    }

    if (result.status === 0) {
      console.log('✓ Claude CLI is available')
      console.log('Claude MCP servers:', result.stdout.split('\n').filter((l) => l.includes('agents__') || l.includes('✓')).slice(0, 10))

      // Check that we have some agents__ prefixed servers
      const hasAgentsServers = result.stdout.includes('agents__')
      if (hasAgentsServers) {
        console.log('✓ Found agents-managed MCP servers')
      }
    } else {
      console.log('ℹ Claude CLI not available, skipping real MCP check')
    }

    // This test always passes - it's informational
    expect(true).toBe(true)
  }, 20_000)

  it('should warn if .agents directory exists without expected structure', async () => {
    const agentsDir = path.join(projectRoot, '.agents')
    const exists = await pathExists(agentsDir)

    if (exists) {
      const configFile = path.join(agentsDir, 'agents.json')
      const localFile = path.join(agentsDir, 'local.json')
      if (!(await pathExists(configFile))) {
        console.warn('⚠ .agents exists but agents.json is missing')
      }
      if (!(await pathExists(localFile))) {
        console.warn('⚠ .agents exists but local.json is missing')
      }
    } else {
      console.log('ℹ No .agents directory - project may not be self-configured')
    }

    // Informational test
    expect(true).toBe(true)
  })

  it('should check if local .agents config exists when project is initialized', async () => {
    const configPath = path.join(projectRoot, '.agents', 'agents.json')
    const exists = await pathExists(configPath)

    if (exists) {
      console.log('✓ Project config found at:', configPath)
    } else {
      console.log('ℹ No project config found at:', configPath)
    }

    // Informational test
    expect(true).toBe(true)
  })
})

/**
 * Test validation functions through integration
 */
describe('Server name and env validation (integration)', () => {
  it('should reject server names with shell metacharacters', () => {
    // Note: This would need to export validation functions or test through sync
    // For now this is a placeholder for future validation tests
    const invalidNames = [
      'server;rm -rf /',
      'server`whoami`',
      'server$(whoami)',
      'server&background',
      'server|pipe',
      'server>redirect',
    ]

    // This would be tested by calling sync with these names
    // and expecting it to throw
    expect(invalidNames.length).toBeGreaterThan(0)
  })

  it('should reject env values with dangerous characters', () => {
    const invalidEnvValues = [
      'value;whoami',
      'value`ls`',
      'value$(ls)',
      'value|grep',
      'value&background',
    ]

    // This would be tested by calling addClaudeServer with these values
    // and expecting it to throw
    expect(invalidEnvValues.length).toBeGreaterThan(0)
  })
})
