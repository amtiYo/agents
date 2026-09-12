import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getProjectPaths } from '../src/core/paths.js'
import { INTEGRATIONS, listManagedConfigs, resolveManagedConfig } from '../src/integrations/registry.js'
import { INTEGRATION_SYNC_HOOKS } from '../src/integrations/syncHooks.js'
import type { IntegrationName } from '../src/types.js'

/**
 * Integrations whose configuration file depends on an option or on the platform, so the
 * registry cannot name it. Each is handled where that choice is made, and each is listed
 * here on purpose: a new integration that lands without a descriptor fails this test
 * instead of quietly dropping out of status, doctor and reset.
 */
const WITHOUT_DESCRIPTOR: IntegrationName[] = [
  'claude', // .mcp.json or the machine-local CLI registration, per claudeScope
  'claude_desktop', // a platform path outside the project
  'copilot_cli', // .mcp.json or .github/mcp.json, per copilotCliPath
  'windsurf' // a global path with its own override
]

describe('integration registry', () => {
  it('gives every integration either a config descriptor or a documented reason', () => {
    const missing = INTEGRATIONS.filter(
      (integration) => !integration.config && !WITHOUT_DESCRIPTOR.includes(integration.id),
    ).map((integration) => integration.id)

    expect(missing).toEqual([])
  })

  it('resolves a label and a path for every descriptor', () => {
    const paths = getProjectPaths(path.join(os.tmpdir(), 'agents-registry-probe'))

    for (const integration of INTEGRATIONS) {
      if (!integration.config) continue
      const resolved = resolveManagedConfig(paths, integration.config)
      expect(resolved.filePath.length, integration.id).toBeGreaterThan(0)
      expect(resolved.label.length, integration.id).toBeGreaterThan(0)
    }
  })

  it('lists exactly the enabled integrations that have a descriptor', () => {
    const paths = getProjectPaths(path.join(os.tmpdir(), 'agents-registry-probe'))
    const enabled: IntegrationName[] = ['codex', 'zed', 'claude']

    expect(listManagedConfigs(paths, enabled).map((entry) => entry.id)).toEqual(['codex', 'zed'])
  })

  it('names a generated preview after the format it holds', () => {
    const paths = getProjectPaths(path.join(os.tmpdir(), 'agents-registry-probe'))

    // doctor picks the parser from the extension, so a preview written as JSON must not
    // be called .yaml: the check would pass anything JSON-shaped through a YAML parser.
    for (const hook of INTEGRATION_SYNC_HOOKS) {
      const extension = path.extname(hook.generatedPath(paths))
      expect(['.json', '.jsonc', '.toml', '.yaml'], hook.id).toContain(extension)
    }
    expect(path.extname(paths.generatedGoose)).toBe('.json')
  })

  it('keeps a generated preview for every integration that syncs one', () => {
    const paths = getProjectPaths(path.join(os.tmpdir(), 'agents-registry-probe'))

    for (const hook of INTEGRATION_SYNC_HOOKS) {
      const generated = hook.generatedPath(paths)
      expect(generated, hook.id).toContain(path.join('.agents', 'generated'))
    }
  })
})
